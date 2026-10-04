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

test('separate endpoint CLIs pair by code/native number, then saved ask returns exact private files with cleanup and owned lifecycle', async t => {
  const root = await temporary(t); const redis = await isolatedRedis(t);
  const homes = { mac: join(root, 'mac'), receiver: join(root, 'receiver') };
  for (const home of Object.values(homes)) await mkdir(home, { mode: 0o700 });
  const adminToken = encode(nacl.randomBytes(32)); const handler = secretRelay(redis, adminToken); const wire: string[] = [];
  let created!: () => void; const requestCreated = new Promise<void>(accept => { created = accept; });
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString(); wire.push(body);
    const result = await handler(new Request('https://holocron.invalid/api/secrets', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: request.headers.authorization! }, body }));
    const text = await result.text(); wire.push(text); response.writeHead(result.status); response.end(text);
    if (JSON.parse(body).action === 'create' && result.ok) created();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>(accept => { server.closeAllConnections(); server.close(() => accept()); }));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const verification = join(homes.mac, 'verification'); const helper = join(homes.mac, 'helper');
  await writeFile(helper, `#!${process.execPath}
import {existsSync,readFileSync,watch,writeSync} from 'node:fs';
const path=${JSON.stringify(verification)};
if(process.argv[2]==='--pair-code' && !existsSync(path)) await new Promise(resolve=>{const w=watch(${JSON.stringify(homes.mac)},()=>{if(existsSync(path)){w.close();resolve();}});});
console.log(${JSON.stringify(canary)});console.error(${JSON.stringify(canary)});
writeSync(3,JSON.stringify({cancelled:false,values:process.argv[2]==='--pair-code'?{VERIFICATION_CODE:readFileSync(path,'utf8')}:{API_KEY:${JSON.stringify(canary)}}}));
`, { mode: 0o700 });
  const adminFile = join(homes.mac, 'admin'); await writeFile(adminFile, adminToken, { mode: 0o600 });
  const launch = (args: string[], role: 'mac' | 'receiver' = 'receiver') => {
    const home = homes[role]; const child = spawn(process.execPath, ['--import', resolve('tests/secret-fetch-hook.ts'), resolve('dist/holocron.js'), ...args], {
      cwd: home, env: { PATH: process.env.PATH, HOME: home, HOLOCRON_CLI_HOME: join(home, 'profile'), HOLOCRON_TEST_RELAY_URL: `http://127.0.0.1:${address.port}/api/secrets` }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = ''; const listeners: ((s: string) => void)[] = [];
    child.stdout.on('data', b => { stdout += b.toString(); for (const listener of listeners) listener(stdout); }); child.stderr.on('data', b => { stderr += b.toString(); });
    const done = once(child, 'exit'); t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
    const match = (pattern: RegExp) => new Promise<RegExpExecArray>((accept, reject) => {
      const timeout = setTimeout(() => reject(new Error('isolated CLI metadata timed out')), 10000);
      const listener = (s: string) => { const result = pattern.exec(s); if (result) { clearTimeout(timeout); accept(result); } };
      listeners.push(listener); listener(stdout); void done.then(() => { if (!pattern.test(stdout)) { clearTimeout(timeout); reject(new Error(stderr || 'CLI exited before metadata')); } });
    });
    return { child, done, match, stdout: () => stdout, stderr: () => stderr };
  };
  const setup = launch(['setup', '--admin-file', adminFile, '--prompt', helper, '--relay', 'https://holocron.invalid/api/secrets'], 'mac');
  assert.equal((await setup.done)[0], 0, setup.stderr());
  const pair = launch(['pair'], 'mac'); const code = (await pair.match(/Pairing code: ([A-Z2-7-]+)/))[1]!;
  const receiver = launch(['setup', 'receiver', '--code', code, '--relay', 'https://holocron.invalid/api/secrets', '--recipient', 'Actual separate test endpoint']);
  const number = (await receiver.match(/Verification number: (\d{8})/))[1]!; await writeFile(verification, number, { mode: 0o600 });
  assert.equal((await receiver.done)[0], 0, receiver.stderr()); assert.equal((await pair.done)[0], 0, pair.stderr());
  const receiverSetup = JSON.parse(await readFile(join(homes.receiver, 'profile/setup.json'), 'utf8'));
  const receiverPairing = JSON.parse(await readFile(receiverSetup.receiverConfig, 'utf8'));
  const macSetup = JSON.parse(await readFile(join(homes.mac, 'profile/setup.json'), 'utf8'));
  const macPairing = JSON.parse(await readFile(macSetup.macConfigs[0], 'utf8'));
  for (const secret of [receiverPairing.token, receiverPairing.signSecret]) {
    assert.equal(wire.join('\n').includes(secret), false); assert.equal(JSON.stringify(macPairing).includes(secret), false);
    assert.equal(receiver.stdout().includes(secret), false);
  }
  const repeat = launch(['setup', 'receiver', '--code', 'WRONG']); assert.equal((await repeat.done)[0], 0, repeat.stderr());
  const ask = launch(['ask', '-m', 'Approved isolated application', 'API_KEY']); await requestCreated;
  const mac = launch(['start'], 'mac'); assert.equal((await ask.done)[0], 0, ask.stderr());
  const directory = ask.stdout().trim(); assert.equal(ask.stderr(), ''); assert.equal(ask.stdout().split('\n').length, 2);
  assert.deepEqual(await readFile(join(directory, 'API_KEY')), Buffer.from(canary));
  assert.equal((await stat(directory)).mode & 0o777, 0o700); assert.equal((await stat(join(directory, 'API_KEY'))).mode & 0o777, 0o600);
  const status = launch(['status'], 'mac'); assert.equal((await status.done)[0], 0); assert.equal(JSON.parse(status.stdout()).runtime, 'running');
  const stop = launch(['stop'], 'mac'); assert.equal((await stop.done)[0], 0); assert.equal((await mac.done)[0], 0, mac.stderr());
  const clean = launch(['secrets', 'cleanup', '--directory', directory]); assert.equal((await clean.done)[0], 0); await assert.rejects(stat(directory));
  for (const text of [wire.join('\n'), pair.stdout(), pair.stderr(), receiver.stdout(), receiver.stderr(), mac.stdout(), mac.stderr()]) assert.equal(text.includes(canary), false);
  const revoke = launch(['secrets', 'revoke', '--mac-config', macSetup.macConfigs[0]], 'mac'); assert.equal((await revoke.done)[0], 0);
  const denied = launch(['ask', '-m', 'Revoked pairing', 'API_KEY']); assert.equal((await denied.done)[0], 1); assert.equal(denied.stdout(), '');
  await assert.rejects(stat(join(homes.receiver, '.config/gh')));
});
