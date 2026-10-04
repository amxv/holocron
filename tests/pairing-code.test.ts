import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import nacl from 'tweetnacl';
import { temporary } from './bridge-fixtures.ts';
import { isolatedRedis } from './secret-fixtures.ts';
import { secretRelay } from '../src/secret-relay.ts';
import { relayClient } from '../src/secret-client.ts';
import { offerPairing, receivePairing } from '../src/pairing-code.ts';
import { CODE_MS, checkMacReveal, commitmentCode, offerCommitment, parseOffer, verificationCode } from '../src/pairing-code-wire.ts';
import { decode, encode } from '../src/secret-crypto.ts';
import { prepareReceiver } from '../src/secret-enrollment.ts';
import { readPairing } from '../src/secret-pairing.ts';
import { nativeCodePairPrompt } from '../src/secret-prompt.ts';

async function fixture(t: Parameters<typeof temporary>[0]) {
  const root = await temporary(t); const redis = await isolatedRedis(t); let offset = 0;
  const admin = encode(nacl.randomBytes(32)); const relay = 'https://holocron.invalid/api/secrets';
  const handler = secretRelay(redis, admin, () => Date.now() + offset); const wire: string[] = [];
  const fetcher: typeof fetch = async (url, init) => { wire.push(String(init?.body)); const response = await handler(new Request(String(url), init)); wire.push(await response.clone().text()); return response; };
  const call = (code: string, token: string) => relayClient({ relay, token, channel: { channel: code } } as Parameters<typeof relayClient>[0], fetcher);
  const prompt = join(root, 'helper'); await writeFile(prompt, '#!/bin/sh\nexit 1\n', { mode: 0o700 });
  const adminFile = join(root, 'admin'); await writeFile(adminFile, admin, { mode: 0o600 });
  let codeReady!: (v: string) => void; const code = new Promise<string>(accept => { codeReady = accept; });
  const output: string[] = [];
  const emit = (line: string) => { output.push(line); const match = /Pairing code: ([A-Z2-7-]+)/.exec(line); if (match) codeReady(match[1]!.replaceAll('-', '')); };
  const macDirectory = join(root, 'mac'); const receiverDirectory = join(root, 'receiver');
  const options = { directory: macDirectory, relay, prompt, adminFile };
  const provision = async (pairing: Parameters<typeof relayClient>[0], token: string, signal: AbortSignal) => relayClient({ ...pairing, token }, fetcher)('provision', pairing.channel, signal);
  return { root, redis, admin, call, code, output, emit, wire, options, receiverDirectory, relay, provision, expire: () => { offset += CODE_MS + 1000; } };
}

test('real Redis code pairing freezes peers, requires intended receiver verification and keeps receiver private material local', async t => {
  const f = await fixture(t); let expected = ''; let approvals = 0;
  const mac = offerPairing(f.options, new AbortController().signal, { call: f.call, interval: 2, output: f.emit, provision: f.provision,
    approve: async number => { approvals++; assert.equal(number, expected); return true; } });
  const code = await f.code;
  assert.match(f.output[0]!, /expires in fifteen minutes/);
  const receiver = await receivePairing({ directory: f.receiverDirectory, relay: f.relay, recipient: 'Intended Linux agent', code }, new AbortController().signal,
    { call: f.call, interval: 2, output: line => { expected = /Verification number: (\d{8})/.exec(line)![1]!; } });
  const macConfig = await mac; assert.equal(approvals, 1);
  const r = await readPairing(receiver, 'receiver'); const m = await readPairing(macConfig, 'mac'); assert.deepEqual(r.channel, m.channel);
  for (const secret of [r.token, r.signSecret!]) { assert.equal(f.wire.join('\n').includes(secret), false); assert.equal((await readFile(macConfig, 'utf8')).includes(secret), false); }
  assert.equal((await readFile(receiver, 'utf8')).includes(f.admin), false);
  assert.equal((await stat(receiver)).mode & 0o777, 0o600); assert.equal((await stat(f.receiverDirectory)).mode & 0o777, 0o700);
  assert.deepEqual(await readdir(f.receiverDirectory), ['receiver.json']);
  assert.equal(f.output.join('\n').includes(m.token), false);
  await assert.rejects(receivePairing({ directory: join(f.root, 'reuse'), relay: f.relay, recipient: 'Reuse', code }, new AbortController().signal, { call: f.call, output: () => {} }), /pairing_code_used/);
  await assert.rejects(stat(join(f.root, 'reuse')));
  f.expire(); await assert.rejects(f.call(code, encode(nacl.randomBytes(32)))('code-peek', {}), /pairing_code_expired_or_invalid/);
});

test('wrong code, expired code and concurrent receivers fail atomically; a denied native prompt cancels and cleans receiver state', async t => {
  const f = await fixture(t); const stop = new AbortController();
  const mac = offerPairing(f.options, stop.signal, { call: f.call, interval: 2, output: f.emit, provision: f.provision, approve: async () => false });
  const rejectedMac = assert.rejects(mac, /pairing_cancelled/); const code = await f.code;
  await assert.rejects(f.call('A'.repeat(20), encode(nacl.randomBytes(32)))('code-peek', {}), /pairing_code_expired_or_invalid/);
  const receivers = [f.receiverDirectory, join(f.root, 'other')].map(directory => receivePairing({ directory, relay: f.relay, recipient: 'Intended agent', code }, stop.signal, { call: f.call, interval: 2, output: () => {} }));
  const results = await Promise.allSettled(receivers); await rejectedMac;
  assert.equal(results.every(r => r.status === 'rejected'), true);
  assert.equal(results.some(r => r.status === 'rejected' && /pairing_code_used/.test(String(r.reason))), true);
  for (const path of [f.receiverDirectory, join(f.root, 'other'), f.options.directory]) await assert.rejects(stat(path));
});

test('code binds Mac commitment; transcript/SAS binds signing key, recipient and token hash; zero DH points fail', async t => {
  const root = await temporary(t); const relay = 'https://holocron.invalid/api/secrets';
  const prepared = await prepareReceiver(join(root, 'receiver'), relay, 'Intended endpoint');
  const pending = JSON.parse(await readFile(prepared.pendingFile, 'utf8'));
  const key = nacl.box.keyPair(); const mac = { nonce: encode(nacl.randomBytes(32)), macBoxPublic: encode(key.publicKey) };
  const expiresAt = Date.now() + 200000; const commitment = offerCommitment(relay, expiresAt, mac);
  const offer = { version: 1 as const, code: commitmentCode(commitment), commitment, expiresAt };
  const reveal = { nonce: encode(nacl.randomBytes(32)), descriptor: pending.descriptor };
  const a = verificationCode(offer, mac, reveal, key.secretKey, 'mac');
  assert.equal(a, verificationCode(offer, mac, reveal, decode(pending.enrollmentSecret), 'receiver'));
  for (const replacement of [{ ...mac, nonce: encode(nacl.randomBytes(32)) }, { ...mac, macBoxPublic: encode(nacl.box.keyPair().publicKey) }]) assert.throws(() => checkMacReveal(offer, relay, replacement), /pairing_peer_mismatch/);
  assert.throws(() => parseOffer({ ...offer, commitment: 'a'.repeat(64) }, offer.code));
  assert.throws(() => parseOffer(offer, offer.code, expiresAt + 1));
  for (const patch of [{ recipient: 'Wrong endpoint' }, { receiverTokenHash: 'a'.repeat(64) }, { receiverSignPublic: encode(nacl.sign.keyPair().publicKey) }]) {
    assert.notEqual(a, verificationCode(offer, mac, { ...reveal, descriptor: { ...reveal.descriptor, ...patch } }, key.secretKey, 'mac'));
  }
  assert.throws(() => verificationCode(offer, mac, { ...reveal, descriptor: { ...reveal.descriptor, enrollmentPublic: encode(new Uint8Array(32)) } }, key.secretKey, 'mac'), /invalid_recipient_key/);
});

test('native approval rejects wrong verification digits and suppresses helper diagnostics', async t => {
  const root = await temporary(t); const helper = join(root, 'helper');
  await writeFile(helper, `#!${process.execPath}\nimport {writeSync} from 'node:fs';console.log('synthetic ignored diagnostic');writeSync(3,JSON.stringify({cancelled:false,values:{VERIFICATION_CODE:'87654321'}}));\n`, { mode: 0o700 });
  await assert.rejects(nativeCodePairPrompt(helper, 'Intended receiver', 'https://holocron.invalid/api/secrets', Date.now() + 10000, '12345678', new AbortController().signal), /pairing_peer_mismatch/);
});

test('unused code expiry and relay quotas fail closed without receiver state or a prompt', async t => {
  const f = await fixture(t); const stop = new AbortController();
  const mac = offerPairing(f.options, stop.signal, { call: f.call, interval: 2, output: f.emit, approve: async () => assert.fail('expired code must not prompt') });
  const failed = assert.rejects(mac); const code = await f.code; f.expire();
  await assert.rejects(receivePairing({ directory: f.receiverDirectory, relay: f.relay, recipient: 'Agent', code }, stop.signal, { call: f.call, output: () => {} }), /pairing_code_expired_or_invalid/);
  await failed; await assert.rejects(stat(f.receiverDirectory));
  await f.redis.command(['SET', 'holocron-code-v1:global-rate', '600']);
  await assert.rejects(f.call(code, encode(nacl.randomBytes(32)))('code-peek', {}), /rate_limited/);
});

test('receiver cancellation/backend loss closes native approval and provisions nothing; unacknowledged provisioning retains revocation material', async t => {
  for (const backendLoss of [false, true]) {
    const f = await fixture(t); const controller = new AbortController(); let promptStarted!: () => void;
    const started = new Promise<void>(accept => { promptStarted = accept; }); let closed = false; let fail = false;
    const wrapped = (c: string, token: string) => {
      const call = f.call(c, token); return async (a: string, d: unknown, s?: AbortSignal) => { if (fail && a === 'code-poll') throw new Error('synthetic unavailable'); return call(a, d, s); };
    };
    const mac = offerPairing(f.options, new AbortController().signal, { call: wrapped, interval: 2, output: f.emit,
      provision: async () => assert.fail('failed/cancelled approval must not provision'), approve: async (_v, _r, s) => {
        promptStarted(); await new Promise<void>(accept => s.addEventListener('abort', () => { closed = true; accept(); }, { once: true })); return false;
      } });
    const rejectedMac = assert.rejects(mac); const code = await f.code;
    const receive = receivePairing({ directory: f.receiverDirectory, relay: f.relay, recipient: 'Agent', code }, controller.signal, { call: f.call, interval: 2, output: () => {} });
    const rejectedReceive = assert.rejects(receive); await started;
    if (backendLoss) fail = true; else controller.abort();
    await rejectedMac; controller.abort(); await rejectedReceive; assert.equal(closed, true);
    await assert.rejects(stat(f.options.directory)); await assert.rejects(stat(f.receiverDirectory));
  }
  const f = await fixture(t); const stop = new AbortController();
  const mac = offerPairing(f.options, stop.signal, { call: f.call, interval: 2, output: f.emit, approve: async () => true,
    provision: async () => ({}) });
  const rejectedMac = assert.rejects(mac, /pairing_incomplete_revoke_mac_config/); const code = await f.code;
  const receiver = receivePairing({ directory: f.receiverDirectory, relay: f.relay, recipient: 'Agent', code }, stop.signal, { call: f.call, interval: 2, output: () => {} });
  const rejectedReceive = assert.rejects(receiver); await rejectedMac; stop.abort(); await rejectedReceive;
  await readPairing(join(f.options.directory, 'mac.json'), 'mac'); await assert.rejects(stat(join(f.options.directory, 'enrollment.json')));
});
