import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmod, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import nacl from 'tweetnacl';
import { temporary } from './bridge-fixtures.ts';
import { canary, pairings } from './secret-fixtures.ts';
import { decryptSecrets, encryptSecrets, verifyRequest, encode } from '../src/secret-crypto.ts';
import { readPairing, relayUrl } from '../src/secret-pairing.ts';
import { prepareReceiver, pairReceiver, completeReceiver } from '../src/secret-enrollment.ts';
import { writeSecretFiles, removeSecretFiles } from '../src/secret-files.ts';
import { nativeSecretPrompt } from '../src/secret-prompt.ts';
import { runHolocronCli } from '../src/holocron-main.ts';
import { parseSecretRequest } from '../src/secret-shapes.ts';
import { buildSecretPrompt } from '../src/secret-prompt-build.ts';
import { askSecrets } from '../src/secret-workflow.ts';

test('NaCl binds pinned sender/recipient, exact request and signed non-secret metadata', () => {
  const f = pairings(); verifyRequest(f.request, f.mac.channel.receiverSignPublic);
  const envelope = encryptSecrets(f.request, { API_KEY: canary }, f.mac.boxSecret!);
  assert.deepEqual(decryptSecrets(f.request, envelope, f.receiverKey.secretKey, f.receiver.channel.macBoxPublic), { API_KEY: canary });
  assert.equal(JSON.stringify(envelope).includes(canary), false);
  assert.throws(() => verifyRequest({ ...f.request, purpose: 'Different task' }, f.mac.channel.receiverSignPublic));
  assert.throws(() => verifyRequest({ ...f.request, receiverPublic: encode(nacl.box.keyPair().publicKey) }, f.mac.channel.receiverSignPublic));
  assert.throws(() => decryptSecrets(f.request, envelope, nacl.box.keyPair().secretKey, f.receiver.channel.macBoxPublic));
  assert.throws(() => decryptSecrets(f.request, envelope, f.receiverKey.secretKey, encode(nacl.box.keyPair().publicKey)));
  assert.throws(() => decryptSecrets({ ...f.request, id: 'a'.repeat(32) }, envelope, f.receiverKey.secretKey, f.receiver.channel.macBoxPublic));
  const damaged = Buffer.from(envelope.ciphertext, 'base64url'); damaged[0] = damaged[0]! ^ 1;
  assert.throws(() => decryptSecrets(f.request, { ...envelope, ciphertext: damaged.toString('base64url') }, f.receiverKey.secretKey, f.receiver.channel.macBoxPublic));
  for (const invalid of [['../KEY'], ['KEY', 'KEY'], ['.expires'], ['BAD\nNAME']]) {
    assert.throws(() => parseSecretRequest({ ...f.request, names: invalid }, Date.now()));
  }
  assert.throws(() => parseSecretRequest({ ...f.request, purpose: '\u202ehidden' }, Date.now()));
  assert.throws(() => parseSecretRequest({ ...f.request, expiresAt: Date.now() - 1 }, Date.now()));
  assert.throws(() => encryptSecrets(f.request, { API_KEY: canary, OTHER: 'extra' }, f.mac.boxSecret!));
  assert.throws(() => encryptSecrets(f.request, { API_KEY: 'x'.repeat(4097) }, f.mac.boxSecret!));
  assert.throws(() => encryptSecrets({ ...f.request, receiverPublic: encode(new Uint8Array(32)) }, { API_KEY: canary }, f.mac.boxSecret!));
  const large = { ...f.request, names: Array.from({ length: 8 }, (_, i) => `KEY_${i}`), purpose: 'p'.repeat(500) };
  const exact = Object.fromEntries(large.names.map((name) => [name, '\u0001'.repeat(4096)]));
  const maximum = encryptSecrets(large, exact, f.mac.boxSecret!);
  assert.ok(Buffer.byteLength(JSON.stringify({ action: 'deliver', channel: large.channel, data: { id: large.id, envelope: maximum } })) < 65536);
  assert.deepEqual(decryptSecrets(large, maximum, f.receiverKey.secretKey, f.receiver.channel.macBoxPublic), exact);
});

test('pairing is explicit owner-only, refuses existing destinations and unsafe private config', async (t) => {
  const root = await temporary(t); const helper = join(root, 'helper'); await writeFile(helper, '#!/bin/sh\nexit 1\n', { mode: 0o700 });
  const prepared = await prepareReceiver(join(root, 'new-receiver'), 'https://holocron.invalid/api/secrets', 'Task computer');
  const admin = join(root, 'admin'); await writeFile(admin, encode(nacl.randomBytes(32)), { mode: 0o600 });
  const paths = await pairReceiver({ directory: join(root, 'new-mac'), descriptorFile: prepared.descriptorFile,
    receiverFingerprint: prepared.receiverFingerprint, prompt: helper, adminFile: admin }, new AbortController().signal,
    { approve: async () => true, provision: async () => ({ ok: true }) });
  const completed = await completeReceiver(prepared.pendingFile, paths.enrollmentFile, paths.macFingerprint);
  const mac = await readPairing(paths.macConfig, 'mac'); const receiver = await readPairing(completed.receiverConfig, 'receiver');
  assert.equal(mac.channel.channel, receiver.channel.channel); assert.equal(mac.channel.receiverSignPublic, receiver.channel.receiverSignPublic);
  assert.notEqual(mac.token, receiver.token); assert.equal(receiver.boxSecret, undefined); assert.equal(mac.signSecret, undefined);
  assert.equal((await stat(paths.macConfig)).mode & 0o777, 0o600); assert.equal((await stat(join(root, 'new-receiver'))).mode & 0o777, 0o700);
  await assert.rejects(readPairing(paths.macConfig, 'receiver'));
  await assert.rejects(prepareReceiver(join(root, 'new-receiver'), mac.relay, 'Task computer'));
  await chmod(completed.receiverConfig, 0o644); await assert.rejects(readPairing(completed.receiverConfig, 'receiver'));
  await chmod(completed.receiverConfig, 0o600); await symlink(completed.receiverConfig, join(root, 'linked.json')); await assert.rejects(readPairing(join(root, 'linked.json'), 'receiver'));
  for (const url of ['http://holocron.invalid/api/secrets', 'https://user:pass@holocron.invalid/api/secrets', 'https://holocron.invalid/api/secrets?token=hidden']) assert.throws(() => relayUrl(url));
});

test('private recipient files preserve exact bytes, reject paths, and clean up failed/cancelled handoffs', async () => {
  let expiry = 0; const directory = await writeSecretFiles({ API_KEY: canary }, { schedule: async (_dir, value) => { expiry = value; } });
  try {
    assert.equal((await stat(directory)).mode & 0o777, 0o700); assert.equal((await stat(join(directory, 'API_KEY'))).mode & 0o777, 0o600);
    assert.deepEqual(await readFile(join(directory, 'API_KEY')), Buffer.from(canary));
    await assert.rejects(removeSecretFiles(directory, expiry + 1));
  } finally { await removeSecretFiles(directory, expiry); }
  await assert.rejects(writeSecretFiles({ '../OUTSIDE': canary }));
  let failed = ''; await assert.rejects(writeSecretFiles({ API_KEY: canary }, { schedule: async (dir) => { failed = dir; throw new Error('scheduler failed'); } }));
  await assert.rejects(stat(failed));
  const signal = AbortSignal.abort(); let cancelled = '';
  await assert.rejects(writeSecretFiles({ API_KEY: canary }, { signal, schedule: async (dir) => { cancelled = dir; } }));
  await assert.rejects(stat(cancelled));
});

test('native helper secrets use FD 3; noisy errors, values, and invalid metadata never reach CLI output', async (t) => {
  const root = await temporary(t); const helper = join(root, 'helper'); const f = pairings();
  await writeFile(helper, `#!${process.execPath}\nimport {writeSync} from 'node:fs';\nconsole.log(${JSON.stringify(canary)});console.error(${JSON.stringify(canary)});writeSync(3,JSON.stringify({cancelled:false,values:{API_KEY:${JSON.stringify(canary)}}}));\n`, { mode: 0o700 });
  assert.deepEqual(await nativeSecretPrompt({ ...f.mac, prompt: helper }, f.request, new AbortController().signal), { API_KEY: canary });
  const output: string[] = []; const errors: string[] = [];
  const io = { stdin: (async function* () {})(), out: (line: string) => output.push(line), error: (line: string) => errors.push(line) };
  const noClipboard = { availability: 'test-adapter' as const, read: async () => assert.fail('secret command read clipboard'), write: async () => assert.fail('secret command wrote clipboard') };
  assert.equal(await runHolocronCli(['ask', '--pairing-file', '/missing', '-m', 'why', 'API_KEY'], io, noClipboard, { env: { BOARD_CLI_HOME: '/missing' } }), 1);
  assert.equal(await runHolocronCli(['secrets', '--help'], io, noClipboard), 0);
  assert.equal(await runHolocronCli(['ask', '--value', canary], io, noClipboard), 2);
  assert.equal(output.join('\n').includes(canary), false); assert.equal(errors.join('\n').includes(canary), false);
  assert.equal(errors.join('\n').includes('/missing'), false);
});

test('Mac prompt builds from packaged native source without launching a GUI or inspecting config', { skip: process.platform !== 'darwin' }, async (t) => {
  const root = await temporary(t); const directory = join(root, 'prompt');
  const helper = await buildSecretPrompt(directory, new AbortController().signal);
  assert.equal((await stat(helper)).mode & 0o777, 0o700);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  assert.ok((await stat(helper)).size > 10_000);
  const icon = join(directory, 'HolocronIcon.png');
  assert.equal((await stat(icon)).mode & 0o777, 0o600);
  assert.deepEqual(await readFile(icon), await readFile(new URL('../native/HolocronIcon.png', import.meta.url)));
  await assert.rejects(buildSecretPrompt(directory, new AbortController().signal));
});

test('an expiring requester destroys its pending request without materializing a secret', async () => {
  const f = pairings(); const operations: string[] = []; let wrote = false;
  await assert.rejects(askSecrets({ ...f.receiver, channel: { ...f.receiver.channel, expiresAt: Date.now() + 30 } }, ['API_KEY'], 'Expiry test', new AbortController().signal, {
    interval: 2, call: async (action, data) => { operations.push(action); if (action === 'create') assert.ok((data as { expiresAt: number }).expiresAt <= Date.now() + 30); return action === 'receive' ? { state: 'pending' } : { ok: true }; },
    write: async () => { wrote = true; return '/unexpected'; },
  }));
  assert.equal(wrote, false); assert.equal(operations.at(-1), 'cancel');
});
