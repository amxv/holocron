import assert from 'node:assert/strict';
import { test } from 'node:test';
import nacl from 'tweetnacl';
import { isolatedRedis, pairings } from './secret-fixtures.ts';
import { CODE_MS, commitmentCode, parseOffer } from '../src/pairing-code-wire.ts';
import { ENROLLMENT_MS } from '../src/secret-enrollment.ts';
import { parseSecretRequest, SECRET_FILE_MS, SECRET_REQUEST_MS } from '../src/secret-shapes.ts';
import { encode, encryptSecrets, signRequest, tokenHash } from '../src/secret-crypto.ts';
import { secretRelay } from '../src/secret-relay.ts';
import { relayClient } from '../src/secret-client.ts';
import { askSecrets, serveSecrets } from '../src/secret-workflow.ts';

test('human deadlines accept fifteen minutes exactly, reject expired/overlong offers and retain five-minute plaintext cleanup', () => {
  const now = Date.now(); const f = pairings(); const commitment = 'a'.repeat(64);
  const code = commitmentCode(commitment);
  assert.equal(CODE_MS, 900_000); assert.equal(SECRET_REQUEST_MS, CODE_MS); assert.equal(ENROLLMENT_MS, CODE_MS);
  assert.equal(SECRET_FILE_MS, 300_000);
  const offer = { version: 1, code, commitment, expiresAt: now + CODE_MS };
  assert.equal(parseOffer(offer, code, now).expiresAt, offer.expiresAt);
  const request = { ...f.request, expiresAt: now + SECRET_REQUEST_MS };
  assert.equal(parseSecretRequest(request, now).expiresAt, request.expiresAt);
  for (const expiry of [now, now - 1, now + CODE_MS + 1]) {
    assert.throws(() => parseOffer({ ...offer, expiresAt: expiry }, code, now), /pairing_code_expired_or_invalid/);
    assert.throws(() => parseSecretRequest({ ...request, expiresAt: expiry }, now), /request_expired_or_invalid/);
  }
  // Shorter earlier-client deadlines remain a valid subset of the wire contract.
  assert.equal(parseOffer({ ...offer, expiresAt: now + 300_000 }, code, now).version, 1);
  assert.equal(parseSecretRequest(f.request, now).version, 1);
});

test('real Redis enforces the fifteen-minute code ceiling and session expiry without extending TTL or replay authority', async t => {
  const redis = await isolatedRedis(t); let now = Date.now(); const started = now;
  const admin = encode(nacl.randomBytes(32)); const owner = encode(nacl.randomBytes(32));
  const handler = secretRelay(redis, admin, () => now);
  const fetcher: typeof fetch = async (url, init) => handler(new Request(String(url), init));
  const commitment = 'b'.repeat(64); const code = commitmentCode(commitment);
  const client = (token: string) => relayClient({ relay: 'https://holocron.invalid/api/secrets', token, channel: { channel: code } } as Parameters<typeof relayClient>[0], fetcher);
  const offer = { version: 1, code, commitment, expiresAt: now + CODE_MS };
  const open = (expiresAt: number) => client(admin)('code-open', { offer: { ...offer, expiresAt }, ownerTokenHash: tokenHash(owner) });
  for (const expiry of [now, now + CODE_MS + 1]) {
    const invalid = await handler(new Request('https://holocron.invalid/api/secrets', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin}` },
      body: JSON.stringify({ action: 'code-open', channel: code, data: { offer: { ...offer, expiresAt: expiry }, ownerTokenHash: tokenHash(owner) } }) }));
    assert.equal(invalid.status, 400); assert.equal((await invalid.json()).error, 'invalid_arguments');
    await assert.rejects(open(expiry), /relay_unavailable/);
  }
  await open(offer.expiresAt);
  const prefix = `holocron-code-v1:${code}`;
  const ttl = Number(await redis.command(['PTTL', prefix]));
  assert.ok(ttl > CODE_MS - 2000 && ttl <= CODE_MS);
  const used = Number(await redis.command(['PTTL', `${prefix}:used`]));
  assert.ok(used >= ttl - 100 && used <= CODE_MS);
  now = started + 5 * 60_000 + 1;
  assert.deepEqual((await client(owner)('code-peek', {})).offer, offer);
  now = offer.expiresAt - 1;
  assert.equal((await client(owner)('code-poll', {})).state, 'open');
  await client(owner)('code-cancel', {});
  assert.equal((await client(owner)('code-poll', {})).state, 'cancelled');
  assert.ok(Number(await redis.command(['PTTL', prefix])) <= ttl);
  await assert.rejects(open(now + 1), /pairing_code_used/);
  now = offer.expiresAt;
  await assert.rejects(client(owner)('code-peek', {}), /pairing_code_expired_or_invalid/);
});

test('request relay/client/mac accept a full fifteen-minute signed request, keep fixed TTL, cancel and expire at its bound', async t => {
  const redis = await isolatedRedis(t); const f = pairings(); let now = Date.now(); const started = now;
  const admin = encode(nacl.randomBytes(32)); const handler = secretRelay(redis, admin, () => now);
  const fetcher: typeof fetch = async (url, init) => handler(new Request(String(url), init));
  const mac = relayClient(f.mac, fetcher); const receiver = relayClient(f.receiver, fetcher);
  await relayClient({ ...f.mac, token: admin }, fetcher)('provision', f.mac.channel);
  const request = signRequest({ ...f.request, expiresAt: now + SECRET_REQUEST_MS }, f.receiver.signSecret!);
  const invalid = await handler(new Request(f.receiver.relay, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${f.receiver.token}` },
    body: JSON.stringify({ action: 'create', channel: request.channel, data: { ...request, expiresAt: request.expiresAt + 1 } }) }));
  assert.equal(invalid.status, 400); assert.equal((await invalid.json()).error, 'request_expired_or_invalid');
  await assert.rejects(receiver('create', { ...request, expiresAt: request.expiresAt + 1 }), /relay_unavailable/);
  await receiver('create', request);
  const prefix = `board-secret-v1:${request.channel}`;
  const ttl = Number(await redis.command(['PTTL', `${prefix}:current`]));
  assert.ok(ttl > SECRET_REQUEST_MS - 2000 && ttl <= SECRET_REQUEST_MS);
  now = started + 5 * 60_000 + 1;
  assert.deepEqual((await mac('claim', {})).request, request);
  const envelope = encryptSecrets(request, { API_KEY: 'harmless-expiry-test' }, f.mac.boxSecret!);
  now = request.expiresAt - 1;
  await mac('deliver', { id: request.id, envelope });
  assert.equal((await receiver('receive', { id: request.id })).state, 'delivered');
  assert.ok(Number(await redis.command(['PTTL', `${prefix}:current`])) <= ttl);
  await assert.rejects(receiver('create', request), /request_replayed/);
  now = request.expiresAt;
  await assert.rejects(receiver('receive', { id: request.id }), /request_unavailable/);

  // The requester creates the full deadline itself; the Mac validates and sees
  // that same signed value. Cancellation still prevents any file handoff.
  const stop = new AbortController(); let emitted = 0;
  await assert.rejects(askSecrets(f.receiver, ['API_KEY'], 'Client deadline', stop.signal, { call: async (action, data) => {
    if (action === 'create') { emitted = (data as typeof request).expiresAt; stop.abort(); }
    return action === 'receive' ? { state: 'cancelled' } : { ok: true };
  }, write: async () => assert.fail('cancelled request must not write') }));
  assert.ok(emitted >= Date.now() + SECRET_REQUEST_MS - 2000 && emitted <= Date.now() + SECRET_REQUEST_MS);
  const sidecarStop = new AbortController(); let prompted = false;
  const fresh = signRequest({ ...f.request, expiresAt: emitted }, f.receiver.signSecret!);
  await serveSecrets(f.mac, sidecarStop.signal, { call: async action => action === 'claim' ? { request: fresh } : { ok: true },
    prompt: async (_pairing, claimed, signal) => { prompted = true; assert.equal(claimed.expiresAt, emitted); assert.equal(signal.aborted, false); sidecarStop.abort(); return null; } });
  assert.equal(prompted, true);
});
