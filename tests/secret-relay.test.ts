import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import nacl from 'tweetnacl';
import { canary, pairings, isolatedRedis } from './secret-fixtures.ts';
import { secretRelay } from '../src/secret-relay.ts';
import { encryptSecrets, encode, signRequest } from '../src/secret-crypto.ts';
import { relayClient } from '../src/secret-client.ts';
import { askSecrets, serveSecrets } from '../src/secret-workflow.ts';
import { writeSecretFiles, removeSecretFiles } from '../src/secret-files.ts';
import { SecretFailure } from '../src/secret-shapes.ts';

test('real Redis atomically enforces scoped authorization, bounded storage, expiry, cancellation, one delivery and replay refusal', async (t) => {
  const redis = await isolatedRedis(t); const f = pairings(); let clock = Date.now(); const admin = encode(nacl.randomBytes(32));
  const handler = secretRelay(redis, admin, () => clock);
  const fetcher: typeof fetch = async (url, init) => handler(new Request(String(url), init));
  const mac = relayClient(f.mac, fetcher); const receiver = relayClient(f.receiver, fetcher);
  const provision = relayClient({ ...f.mac, token: admin }, fetcher);
  await provision('provision', f.mac.channel);
  await assert.rejects(provision('provision', f.mac.channel), /pairing_exists/);
  await assert.rejects(relayClient({ ...f.receiver, token: encode(nacl.randomBytes(32)) }, fetcher)('claim', {}), /unauthorized/);
  await assert.rejects(receiver('claim', {}), /unauthorized/);
  await assert.rejects(mac('create', f.request), /unauthorized/);
  await receiver('create', f.request);
  await assert.rejects(receiver('create', f.request), /request_replayed/);
  const second = signRequest({ ...f.request, id: 'b'.repeat(32) }, f.receiver.signSecret!);
  await assert.rejects(receiver('create', second), /request_busy/);
  const claims = await Promise.all([mac('claim', {}), mac('claim', {})]);
  assert.equal(claims.filter((reply) => reply.request !== null).length, 1);
  const envelope = encryptSecrets(f.request, { API_KEY: canary }, f.mac.boxSecret!);
  await assert.rejects(receiver('deliver', { id: f.request.id, envelope }), /unauthorized/);
  await mac('deliver', { id: f.request.id, envelope });
  const stored = await redis.command(['GET', `board-secret-v1:${f.mac.channel.channel}:current`]);
  assert.equal(stored.includes(canary), false); assert.equal(stored.includes('synthetic-key-'), false); assert.equal(stored.includes(envelope.ciphertext), true);
  const received = await Promise.all([receiver('receive', { id: f.request.id }), receiver('receive', { id: f.request.id })]);
  assert.equal(received.filter((reply) => reply.state === 'delivered').length, 1);
  assert.equal(received.filter((reply) => reply.state === 'consumed').length, 1);
  assert.equal((await redis.command(['GET', `board-secret-v1:${f.mac.channel.channel}:current`])).includes(envelope.ciphertext), false);
  await assert.rejects(mac('deliver', { id: f.request.id, envelope }), /request_unavailable/);
  await receiver('create', second); await mac('claim', {}); await receiver('cancel', { id: second.id });
  assert.equal((await receiver('receive', { id: second.id })).state, 'cancelled');
  await assert.rejects(mac('deliver', { id: second.id, envelope }), /request_unavailable/);
  const third = signRequest({ ...f.request, id: 'c'.repeat(32) }, f.receiver.signSecret!); await receiver('create', third);
  clock = third.expiresAt + 1; await assert.rejects(receiver('receive', { id: third.id }), /request_unavailable/);
  clock = Date.now(); await redis.command(['SET', `board-secret-v1:${f.mac.channel.channel}:quota`, '10']);
  await receiver('cancel', { id: third.id });
  const fourth = signRequest({ ...f.request, id: 'd'.repeat(32) }, f.receiver.signSecret!);
  await assert.rejects(receiver('create', fourth), /request_rate_limited/);
  await redis.command(['SET', `board-secret-v1:${f.mac.channel.channel}:rate`, '240']);
  await assert.rejects(mac('claim', {}), /rate_limited/);
  await redis.command(['DEL', `board-secret-v1:${f.mac.channel.channel}:rate`]);
  await mac('revoke', {}); await assert.rejects(receiver('create', fourth), /unauthorized/);
});

test('requester and Mac workflows hand off exact private files without plaintext relay or output, and promptly cancel human requests', async (t) => {
  const redis = await isolatedRedis(t); const f = pairings(); const admin = encode(nacl.randomBytes(32));
  const handler = secretRelay(redis, admin); const wire: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    wire.push(String(init?.body)); const response = await handler(new Request(String(url), init));
    wire.push(await response.clone().text()); return response;
  };
  const mac = relayClient(f.mac, fetcher); const receiver = relayClient(f.receiver, fetcher);
  await relayClient({ ...f.mac, token: admin }, fetcher)('provision', f.mac.channel);
  const stop = new AbortController(); let promptCalls = 0;
  const worker = serveSecrets(f.mac, stop.signal, { call: mac, idleInterval: 2, activeInterval: 2,
    prompt: async (pair, req) => { promptCalls++; assert.equal(pair.channel.recipient, f.mac.channel.recipient); assert.deepEqual(req.names, ['API_KEY']); return { API_KEY: canary }; } });
  let expiry = 0;
  const directory = await askSecrets(f.receiver, ['API_KEY'], 'Use with the approved test app', new AbortController().signal, {
    call: receiver, interval: 2, write: (values) => writeSecretFiles(values, { schedule: async (_dir, value) => { expiry = value; } }),
  });
  stop.abort(); await worker;
  try {
    assert.equal(promptCalls, 1); assert.deepEqual(await readFile(join(directory, 'API_KEY')), Buffer.from(canary));
    assert.equal((await stat(join(directory, 'API_KEY'))).mode & 0o777, 0o600);
    assert.equal(wire.join('\n').includes(canary), false); assert.equal(wire.join('\n').includes('synthetic-key-'), false);
  } finally { await removeSecretFiles(directory, expiry); }
  const cancel = new AbortController(); const humanStopped = new AbortController(); let promptStarted!: () => void;
  const started = new Promise<void>((accept) => { promptStarted = accept; });
  const waiting = serveSecrets(f.mac, humanStopped.signal, { call: mac, idleInterval: 2, activeInterval: 2,
    prompt: async (_pair, _req, signal) => { promptStarted(); await new Promise<void>((accept) => signal.addEventListener('abort', () => accept(), { once: true })); return null; } });
  const request = askSecrets(f.receiver, ['API_KEY'], 'Cancellation test', cancel.signal, { call: receiver, interval: 2 });
  const rejected = assert.rejects(request);
  await started; cancel.abort(); await rejected; humanStopped.abort(); await waiting;
});

test('public relay rejects plaintext-shaped payloads, browser origins, URL credentials, oversized bodies, and hides backend diagnostics', async () => {
  const f = pairings(); let calls = 0;
  const handler = secretRelay({ eval: async () => { calls++; throw new Error(canary); } }, encode(nacl.randomBytes(32)));
  const request = (body: unknown, extra: Record<string, string> = {}, url = f.mac.relay) => new Request(url, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${f.mac.token}`, ...extra }, body: JSON.stringify(body) });
  const body = { action: 'deliver', channel: f.mac.channel.channel, data: { id: f.request.id, values: { API_KEY: canary } } };
  assert.equal((await handler(request(body))).status, 400); assert.equal(calls, 0);
  assert.equal((await handler(request({ action: 'claim', channel: f.mac.channel.channel, data: {} }, { Origin: 'https://browser.invalid' }))).status, 400);
  assert.equal((await handler(request(body, {}, f.mac.relay + '?token=hidden'))).status, 400);
  assert.equal((await handler(request({ padding: 'x'.repeat(65537) }))).status, 413);
  const failure = await handler(request({ action: 'claim', channel: f.mac.channel.channel, data: {} }));
  assert.equal(failure.status, 503); assert.equal((await failure.text()).includes(canary), false);
  assert.equal(failure.headers.get('cache-control'), 'no-store');
});

test('sidecar never prompts for forged recipient requests and closes an active prompt on backend failure', async () => {
  const f = pairings(); let prompts = 0;
  await assert.rejects(serveSecrets(f.mac, new AbortController().signal, {
    call: async () => ({ request: { ...f.request, purpose: 'forged purpose' } }),
    prompt: async () => { prompts++; return { API_KEY: canary }; },
  }), /secret_request_failed/);
  assert.equal(prompts, 0);
  let closed = false;
  await assert.rejects(serveSecrets(f.mac, new AbortController().signal, {
    call: async (action) => {
      if (action === 'claim') return { request: f.request };
      if (action === 'status') throw new SecretFailure('relay_unavailable');
      if (action === 'cancel') return { ok: true };
      assert.fail('failed backend must not receive a delivery');
    }, activeInterval: 1,
    prompt: async (_pair, _request, signal) => {
      await new Promise<void>((accept) => signal.addEventListener('abort', () => { closed = true; accept(); }, { once: true }));
      return null;
    },
  }), /secret_request_failed/);
  assert.equal(closed, true);
});
