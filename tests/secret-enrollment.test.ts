import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, readFile, stat, writeFile, chmod, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import nacl from 'tweetnacl';
import { temporary } from './bridge-fixtures.ts';
import { encode } from '../src/secret-crypto.ts';
import { prepareReceiver, pairReceiver, completeReceiver, parseDescriptor, macFingerprint } from '../src/secret-enrollment.ts';
import { readPairing } from '../src/secret-pairing.ts';
import { runSecretCli } from '../src/secret-cli.ts';

async function fixture(t: Parameters<typeof temporary>[0]) {
  const root = await temporary(t); const mac = join(root, 'mac'); const receiver = join(root, 'receiver');
  await mkdir(mac, { mode: 0o700 }); await mkdir(receiver, { mode: 0o700 });
  const prepared = await prepareReceiver(join(receiver, 'pair'), 'https://holocron.invalid/api/secrets', 'Intended computer');
  const pending = JSON.parse(await readFile(prepared.pendingFile, 'utf8'));
  const descriptorFile = join(mac, 'descriptor.json'); await writeFile(descriptorFile, await readFile(prepared.descriptorFile), { mode: 0o600 });
  const prompt = join(mac, 'helper'); await writeFile(prompt, '#!/bin/sh\nexit 1\n', { mode: 0o700 });
  const adminFile = join(mac, 'admin-token'); await writeFile(adminFile, encode(nacl.randomBytes(32)), { mode: 0o600 });
  const options = { directory: join(mac, 'pair'), descriptorFile, receiverFingerprint: prepared.receiverFingerprint, prompt, adminFile };
  return { root, mac, receiver, prepared, pending, options };
}
const signal = () => new AbortController().signal;

test('receiver creates its own credentials; native approval is bound to both fingerprints, relay, recipient and expiry', async (t) => {
  const f = await fixture(t); let approvals = 0; let provisions = 0;
  const paired = await pairReceiver(f.options, signal(), {
    approve: async (_prompt, approval) => {
      approvals++; assert.equal(approval.receiverFingerprint, f.prepared.receiverFingerprint);
      assert.equal(approval.descriptorFingerprint, f.prepared.descriptorFingerprint);
      assert.equal(approval.descriptor.recipient, 'Intended computer');
      assert.equal(approval.descriptor.relay, 'https://holocron.invalid/api/secrets');
      assert.ok(approval.expiresAt > Date.now()); assert.match(approval.macFingerprint, /^[a-f0-9]{64}$/);
      return true;
    }, provision: async (pairing, admin) => {
      provisions++; assert.notEqual(pairing.token, f.pending.token); assert.notEqual(pairing.token, admin);
      assert.equal(pairing.channel.receiverTokenHash, f.pending.descriptor.receiverTokenHash);
      return { ok: true };
    },
  });
  assert.equal(approvals, 1); assert.equal(provisions, 1);
  const enrollmentFile = join(f.receiver, 'enrollment.json'); await writeFile(enrollmentFile, await readFile(paired.enrollmentFile), { mode: 0o600 });
  const complete = await completeReceiver(f.prepared.pendingFile, enrollmentFile, paired.macFingerprint);
  const receiver = await readPairing(complete.receiverConfig, 'receiver'); const mac = await readPairing(paired.macConfig, 'mac');
  assert.deepEqual(receiver.channel, mac.channel); assert.equal(receiver.token, f.pending.token);
  assert.equal(receiver.signSecret, f.pending.signSecret); assert.equal(receiver.boxSecret, undefined);
  for (const path of [complete.receiverConfig, paired.macConfig, enrollmentFile]) assert.equal((await stat(path)).mode & 0o777, 0o600);
  await assert.rejects(stat(f.prepared.pendingFile));
  await assert.rejects(completeReceiver(f.prepared.pendingFile, enrollmentFile, paired.macFingerprint));
  const macBytes = (await readFile(paired.macConfig, 'utf8')) + (await readFile(paired.enrollmentFile, 'utf8')) + (await readFile(f.options.descriptorFile, 'utf8'));
  for (const secret of [f.pending.token, f.pending.signSecret, f.pending.enrollmentSecret]) assert.equal(macBytes.includes(secret), false);
});

test('public descriptor tampering, wrong receiver fingerprint and unsafe exchange files fail before a native prompt or network write', async (t) => {
  const f = await fixture(t); let approvals = 0;
  const dependencies = { approve: async () => { approvals++; return true; }, provision: async () => assert.fail('invalid setup must not provision') };
  const original = await readFile(f.options.descriptorFile, 'utf8'); const descriptor = JSON.parse(original);
  for (const patch of [{ recipient: 'Substituted computer' }, { relay: 'https://other.invalid/api/secrets' },
    { enrollmentPublic: encode(nacl.box.keyPair().publicKey) }, { receiverTokenHash: 'a'.repeat(64) },
    { channel: 'a'.repeat(32) }, { expiresAt: Date.now() - 1 }, { expiresAt: Date.now() + 900_001 }]) {
    await writeFile(f.options.descriptorFile, JSON.stringify({ ...descriptor, ...patch }));
    await assert.rejects(pairReceiver(f.options, signal(), dependencies));
  }
  await writeFile(f.options.descriptorFile, original);
  await assert.rejects(pairReceiver({ ...f.options, receiverFingerprint: 'b'.repeat(64) }, signal(), dependencies), /receiver_fingerprint_mismatch/);
  await chmod(f.options.descriptorFile, 0o644); await assert.rejects(pairReceiver(f.options, signal(), dependencies));
  await chmod(f.options.descriptorFile, 0o600);
  const linked = join(f.mac, 'linked.json'); await symlink(f.options.descriptorFile, linked);
  await assert.rejects(pairReceiver({ ...f.options, descriptorFile: linked }, signal(), dependencies));
  assert.equal(approvals, 0); assert.equal(parseDescriptor(descriptor).recipient, 'Intended computer');
});

test('denied or cancelled native approval provisions nothing and removes only the newly owned directory', async (t) => {
  const f = await fixture(t); const provision = async () => assert.fail('denied approval must not provision');
  await assert.rejects(pairReceiver(f.options, signal(), { approve: async () => false, provision }), /pairing_cancelled/);
  await assert.rejects(stat(f.options.directory));
  const controller = new AbortController();
  await assert.rejects(pairReceiver(f.options, controller.signal, { approve: async () => { controller.abort(); return true; }, provision }), /pairing_cancelled/);
  await assert.rejects(stat(f.options.directory));
  assert.equal(JSON.parse(await readFile(f.prepared.pendingFile, 'utf8')).token, f.pending.token);
  const realNow = Date.now;
  try {
    await assert.rejects(pairReceiver(f.options, signal(), {
      approve: async () => { Date.now = () => f.pending.descriptor.expiresAt + 1; return true; }, provision,
    }), /invalid_enrollment/);
  } finally { Date.now = realNow; }
  await assert.rejects(stat(f.options.directory));
});

test('uncertain provisioning truthfully fails and retains the Mac credential for authenticated revocation', async (t) => {
  const f = await fixture(t);
  await assert.rejects(pairReceiver(f.options, signal(), { approve: async () => true,
    provision: async () => { throw new Error('synthetic transport lost after write'); } }), /pairing_incomplete_revoke_mac_config/);
  const mac = await readPairing(join(f.options.directory, 'mac.json'), 'mac'); assert.equal(mac.channel.receiverTokenHash, f.pending.descriptor.receiverTokenHash);
  await assert.rejects(stat(join(f.options.directory, 'enrollment.json')));
  const missingReceipt = { ...f.options, directory: join(f.mac, 'unacknowledged') };
  await assert.rejects(pairReceiver(missingReceipt, signal(), { approve: async () => true, provision: async () => ({}) }), /pairing_incomplete_revoke_mac_config/);
  await readPairing(join(missingReceipt.directory, 'mac.json'), 'mac');
  await assert.rejects(stat(join(missingReceipt.directory, 'enrollment.json')));
});

test('revocation never reports success without the atomic relay acknowledgement or exposes unsafe diagnostics', async (t) => {
  const f = await fixture(t);
  const paired = await pairReceiver(f.options, signal(), { approve: async () => true, provision: async () => ({ ok: true }) });
  const fetcher = globalThis.fetch; const output: string[] = []; const errors: string[] = [];
  const io = { out: (s: string) => output.push(s), error: (s: string) => errors.push(s), stdin: (async function* () {})() };
  try {
    globalThis.fetch = async () => new Response('{}', { status: 200 });
    assert.equal(await runSecretCli(['revoke', '--mac-config', paired.macConfig], io, signal()), 1);
    assert.deepEqual(output, []); assert.deepEqual(errors, ['invalid_relay_response']);
    globalThis.fetch = async () => { throw new Error(f.pending.token); };
    assert.equal(await runSecretCli(['revoke', '--mac-config', paired.macConfig], io, signal()), 1);
    assert.equal(errors.includes(f.pending.token), false); assert.deepEqual(output, []);
  } finally { globalThis.fetch = fetcher; }
});

test('receiver rejects swapped Mac fingerprints, forged ciphertext, another enrollment and replay; completion is atomic', async (t) => {
  const f = await fixture(t);
  const paired = await pairReceiver(f.options, signal(), { approve: async () => true, provision: async () => ({ ok: true }) });
  const original = await readFile(paired.enrollmentFile, 'utf8'); const value = JSON.parse(original);
  await assert.rejects(completeReceiver(f.prepared.pendingFile, paired.enrollmentFile, '0'.repeat(64)), /mac_fingerprint_mismatch/);
  const otherKey = encode(nacl.box.keyPair().publicKey);
  for (const corrupted of [
    { ...value, macBoxPublic: otherKey }, { ...value, descriptorFingerprint: 'a'.repeat(64) },
    { ...value, envelope: { ...value.envelope, nonce: encode(nacl.randomBytes(24)) } },
    { ...value, envelope: { ...value.envelope, ciphertext: encode(nacl.randomBytes(128)) } },
  ]) {
    await writeFile(paired.enrollmentFile, JSON.stringify(corrupted));
    await assert.rejects(completeReceiver(f.prepared.pendingFile, paired.enrollmentFile, paired.macFingerprint));
    await assert.rejects(stat(join(f.receiver, 'pair', 'receiver.json')));
  }
  await writeFile(paired.enrollmentFile, JSON.stringify({ ...value, macBoxPublic: otherKey }));
  await assert.rejects(completeReceiver(f.prepared.pendingFile, paired.enrollmentFile, macFingerprint(otherKey)), /enrollment_authentication_failed/);
  await writeFile(paired.enrollmentFile, original);
  const other = await prepareReceiver(join(f.receiver, 'other'), 'https://holocron.invalid/api/secrets', 'Another computer');
  await assert.rejects(completeReceiver(other.pendingFile, paired.enrollmentFile, paired.macFingerprint), /enrollment_request_mismatch/);
  const results = await Promise.allSettled([completeReceiver(f.prepared.pendingFile, paired.enrollmentFile, paired.macFingerprint),
    completeReceiver(f.prepared.pendingFile, paired.enrollmentFile, paired.macFingerprint)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
  await readPairing(join(f.receiver, 'pair', 'receiver.json'), 'receiver');
});
