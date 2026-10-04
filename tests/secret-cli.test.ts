import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import nacl from 'tweetnacl';
import { temporary } from './bridge-fixtures.ts';
import { isolatedRedis, canary } from './secret-fixtures.ts';
import { secretRelay } from '../src/secret-relay.ts';
import { encode } from '../src/secret-crypto.ts';
import { relayClient } from '../src/secret-client.ts';
import { removeSecretFiles } from '../src/secret-files.ts';

test('isolated Mac/receiver CLI subprocesses deliver only a recipient-local path and preserve unrelated Board contracts', async (t) => {
  const root = await temporary(t); const redis = await isolatedRedis(t);
  const macHome = join(root, 'mac'); const receiverHome = join(root, 'receiver');
  await mkdir(macHome, { mode: 0o700 }); await mkdir(receiverHome, { mode: 0o700 });
  const adminToken = encode(nacl.randomBytes(32));
  const handler = secretRelay(redis, adminToken);
  let requestCreated!: () => void; const created = new Promise<void>((accept) => { requestCreated = accept; });
  const observed: string[] = [];
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString(); observed.push(body);
      const result = await handler(new Request('https://holocron.invalid/api/secrets', { method: request.method,
        headers: { 'Content-Type': 'application/json', Authorization: request.headers.authorization! }, body }));
      const text = await result.text(); observed.push(text);
      response.writeHead(result.status, { 'Content-Type': 'application/json' }); response.end(text);
      if (JSON.parse(body).action === 'create' && result.ok) requestCreated();
    } catch { response.writeHead(503); response.end('{"error":"test_failed"}'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>((accept) => { server.closeAllConnections(); server.close(() => accept()); }));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const sharedEnv = { PATH: process.env.PATH, HOLOCRON_TEST_RELAY_URL: `http://127.0.0.1:${address.port}/api/secrets` };
  const helper = join(macHome, 'injected-helper');
  await writeFile(helper, `#!${process.execPath}\nimport {writeSync} from 'node:fs';\nconsole.log(${JSON.stringify(canary)});console.error(${JSON.stringify(canary)});writeSync(3,JSON.stringify({cancelled:false,values:process.argv[2]==='--pair'?{}:{API_KEY:${JSON.stringify(canary)}}}));\n`, { mode: 0o700 });
  const adminFile = join(macHome, 'admin-token'); await writeFile(adminFile, adminToken, { mode: 0o600 });
  const launch = (args: string[], home = receiverHome) => {
    const child = spawn(process.execPath, ['--import', resolve('tests/secret-fetch-hook.ts'), resolve('dist/holocron.js'), ...args], { env: { ...sharedEnv, HOME: home }, cwd: home, stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = []; const errors: Buffer[] = []; child.stdout.on('data', (bytes) => out.push(bytes)); child.stderr.on('data', (bytes) => errors.push(bytes));
    const done = once(child, 'exit'); t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
    return { child, done, stdout: () => Buffer.concat(out).toString(), stderr: () => Buffer.concat(errors).toString() };
  };
  const prepare = launch(['secrets', 'prepare', '--directory', join(receiverHome, 'pair'), '--relay', 'https://holocron.invalid/api/secrets', '--recipient', 'Isolated receiver computer']);
  assert.equal((await prepare.done)[0], 0); assert.equal(prepare.stderr(), '');
  const prepared = JSON.parse(prepare.stdout());
  const privatePending = JSON.parse(await readFile(prepared.pendingFile, 'utf8'));
  const descriptorFile = join(macHome, 'descriptor.json');
  await writeFile(descriptorFile, await readFile(prepared.descriptorFile), { mode: 0o600 }); // Public descriptor only.
  const pair = launch(['secrets', 'pair', '--directory', join(macHome, 'pair'), '--descriptor-file', descriptorFile,
    '--receiver-fingerprint', prepared.receiverFingerprint, '--prompt', helper, '--admin-file', adminFile], macHome);
  assert.equal((await pair.done)[0], 0, pair.stderr()); assert.equal(pair.stderr(), '');
  const paired = JSON.parse(pair.stdout()); const macConfig = paired.macConfig;
  const publicEnrollment = await readFile(paired.enrollmentFile);
  const enrollmentFile = join(receiverHome, 'enrollment.json');
  await writeFile(enrollmentFile, publicEnrollment, { mode: 0o600 }); // Ciphertext only; no private transfer channel.
  const complete = launch(['secrets', 'complete', '--pending-file', prepared.pendingFile,
    '--enrollment-file', enrollmentFile, '--mac-fingerprint', paired.macFingerprint]);
  assert.equal((await complete.done)[0], 0, complete.stderr()); assert.equal(complete.stderr(), '');
  const receiverConfig = JSON.parse(complete.stdout()).receiverConfig;
  await assert.rejects(stat(prepared.pendingFile));
  const macPairing = JSON.parse(await readFile(macConfig, 'utf8'));
  const receiverPairing = JSON.parse(await readFile(receiverConfig, 'utf8'));
  assert.equal(receiverPairing.token, privatePending.token); assert.equal(receiverPairing.signSecret, privatePending.signSecret);
  const exchange = [prepare.stdout(), pair.stdout(), complete.stdout(), publicEnrollment.toString(), await readFile(descriptorFile, 'utf8'), JSON.stringify(macPairing)].join('\n');
  for (const credential of [privatePending.token, privatePending.signSecret, privatePending.enrollmentSecret]) assert.equal(exchange.includes(credential), false);
  assert.equal(receiverPairing.boxSecret, undefined); assert.equal(JSON.stringify(receiverPairing).includes(adminToken), false);
  assert.equal(JSON.stringify(receiverPairing).includes(macPairing.token), false);
  const receiver = launch(['ask', '--pairing-file', receiverConfig, '-m', 'Use the key with this approved isolated app', 'API_KEY']);
  await Promise.race([created, receiver.done.then(() => assert.fail('requester exited before creating request'))]);
  const mac = launch(['secrets', 'serve', '--mac-config', macConfig], macHome);
  const [exit] = await receiver.done; assert.equal(exit, 0); mac.child.kill('SIGTERM'); await mac.done;
  const directory = receiver.stdout().trim(); assert.equal(receiver.stderr(), '');
  assert.match(directory, /\/holocron-secrets-\d+\/session-[A-Za-z0-9]+$/);
  try {
    assert.deepEqual(await readFile(join(directory, 'API_KEY')), Buffer.from(canary));
    assert.equal((await stat(join(directory, 'API_KEY'))).mode & 0o777, 0o600);
    assert.equal(observed.join('\n').includes(canary), false); assert.equal(observed.join('\n').includes('synthetic-key-'), false);
    assert.equal(mac.stdout().includes(canary), false); assert.equal(mac.stderr().includes(canary), false);
    assert.equal(mac.stdout().includes(macPairing.token), false); assert.equal(receiver.stdout().includes(receiverPairing.token), false);
  } finally {
    const cleanup = launch(['secrets', 'cleanup', '--directory', directory]);
    assert.equal((await cleanup.done)[0], 0); assert.deepEqual(JSON.parse(cleanup.stdout()), { cleaned: true });
    await assert.rejects(stat(directory));
  }
  const revoke = launch(['secrets', 'revoke', '--mac-config', macConfig], macHome);
  assert.equal((await revoke.done)[0], 0); assert.deepEqual(JSON.parse(revoke.stdout()), { revoked: true });
  const denied = launch(['ask', '--pairing-file', receiverConfig, '-m', 'Revocation regression', 'API_KEY']);
  assert.equal((await denied.done)[0], 1); assert.equal(denied.stdout(), ''); assert.equal(denied.stderr().trim(), 'unauthorized');
  for (const home of [macHome, receiverHome]) await assert.rejects(stat(join(home, '.config')));
  await assert.rejects(stat(join(root, '.config', 'board'))); // Secret commands never inspect/create ordinary Board profiles.
});

test('production cleanup child acknowledges private state and removes short-lived files after requester exit', async () => {
  const { writeSecretFiles } = await import(new URL('../dist/secret-files.js', import.meta.url).href) as typeof import('../src/secret-files.ts');
  const directory = await writeSecretFiles({ API_KEY: canary }, { lifetime: 300 });
  const { watch } = await import('node:fs');
  await new Promise<void>((accept, reject) => {
    const watcher = watch(directory, async () => {
      try { await stat(directory); } catch { clearTimeout(timeout); watcher.close(); accept(); }
    });
    const timeout = setTimeout(() => { watcher.close(); reject(new Error('cleanup did not remove private files')); }, 5000);
  });
  await assert.rejects(stat(directory));
});
