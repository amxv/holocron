import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdir, readFile, readdir, stat, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { temporary } from './bridge-fixtures.ts';
import { setupMac, readSetup, saveSetup } from '../src/setup-profile.ts';
import { runSetupCli } from '../src/setup-cli.ts';
import { operatorControl, recoverOperator, startOperator, tunnelArguments } from '../src/operator-runtime.ts';
import { linkConfig } from '../src/holocron-profile.ts';
import { runHolocronCli } from '../src/holocron-main.ts';
import { encode } from '../src/secret-crypto.ts';
import nacl from 'tweetnacl';

async function fixture(t: Parameters<typeof temporary>[0]) {
  const root = await temporary(t); const home = join(root, 'profile'); await mkdir(home, { mode: 0o700 });
  const admin = join(root, 'admin'); await writeFile(admin, encode(nacl.randomBytes(32)), { mode: 0o600 });
  const prompt = join(root, 'helper'); await writeFile(prompt, '#!/bin/sh\nexit 1\n', { mode: 0o700 });
  const output: string[] = []; const errors: string[] = [];
  const io = { out: (s: string) => output.push(s), error: (s: string) => errors.push(s), stdin: (async function* () {})() };
  const env = { HOLOCRON_CLI_HOME: home }; const signal = new AbortController().signal;
  return { root, home, admin, prompt, output, errors, io, env, signal };
}
test('Mac setup reuses linked Board config/helper, is repeatable, preserves unrelated files and rejects unsafe/conflicting setup', async t => {
  const f = await fixture(t); const local = join(f.root, 'board-local.json');
  await writeFile(local, JSON.stringify({ transport: 'stdio', stateDirectory: join(f.root, 'existing-board-state') }), { mode: 0o600 });
  await linkConfig(f.home, local); await writeFile(join(f.root, 'unrelated'), 'keep');
  const flags = { '--admin-file': f.admin, '--prompt': f.prompt };
  const first = await setupMac(f.home, flags, f.signal); assert.equal(first.localConfig, local);
  const before = await readFile(join(f.home, 'setup.json')); await setupMac(f.home, {}, f.signal);
  assert.deepEqual(await readFile(join(f.home, 'setup.json')), before); assert.equal(await readFile(join(f.root, 'unrelated'), 'utf8'), 'keep');
  assert.equal((await stat(join(f.home, 'setup.json'))).mode & 0o777, 0o600);
  await chmod(f.admin, 0o644); await assert.rejects(setupMac(f.home, flags, f.signal)); await chmod(f.admin, 0o600);
  assert.deepEqual(await readFile(join(f.home, 'setup.json')), before);
  assert.equal(await runSetupCli(['setup'], f.io, f.signal, f.env), 0); assert.equal((await readdir(f.home)).includes('setup.lock'), false);
  await saveSetup(f.home, { version: 1, role: 'receiver', relay: first.relay, macConfigs: [] });
  await assert.rejects(setupMac(f.home, flags, f.signal), /setup_role_conflict/);
});
test('setup failure and retry remove only their lock; explicit profile binding needs no credential copy or tunnel provisioning', async t => {
  const f = await fixture(t);
  assert.equal(await runSetupCli(['setup'], f.io, f.signal, f.env), 1);
  assert.deepEqual(await readdir(f.home), []);
  const profile = join(f.root, 'existing.yaml'); const bytes = 'control_plane:\n  api_key: file:/private/fixture/runtime-key\n';
  await writeFile(profile, bytes, { mode: 0o600 });
  const cli = join(f.root, 'tunnel'); await writeFile(cli, '#!/bin/sh\nexit 1\n', { mode: 0o700 });
  assert.equal(await runSetupCli(['setup', '--admin-file', f.admin, '--prompt', f.prompt, '--tunnel-profile', profile, '--tunnel-client', cli], f.io, f.signal, f.env), 0);
  const p = await readSetup(f.home); assert.equal(await readFile(profile, 'utf8'), bytes);
  const setup = await readFile(join(f.home, 'setup.json'), 'utf8'); assert.equal(setup.includes('runtime-key'), false);
  const args = tunnelArguments(p, join(f.home, 'health')); assert.equal(args.includes('init'), false); assert.equal(args.includes('connect'), false);
  assert.equal(args[args.indexOf('--profile-file') + 1], profile);
  assert.match(args[args.indexOf('--mcp.command') + 1]!, /stdio.*--local-config/);
  assert.equal(args.some(s => /admin-key|runtime-api-key|tunnel-id/.test(s)), false);
});
test('owned supervisor start/status/stop is idempotent; failure rollback and stale socket recovery preserve external runtimes', async t => {
  const f = await fixture(t); const tunnel = join(f.root, 'tunnel'); const profile = join(f.root, 'profile.yaml');
  await writeFile(profile, 'SYNTHETIC_PROFILE', { mode: 0o600 });
  await writeFile(tunnel, `#!${process.execPath}\nsetInterval(()=>{},1000);process.on('SIGTERM',()=>process.exit(0));\n`, { mode: 0o700 });
  await setupMac(f.home, { '--admin-file': f.admin, '--prompt': f.prompt, '--tunnel-profile': profile, '--tunnel-client': tunnel }, f.signal);
  let ready!: () => void; const started = new Promise<void>(accept => { ready = accept; }); const stop = new AbortController();
  const running = startOperator(f.home, stop.signal, () => ready()); await started;
  assert.equal((await operatorControl(f.home, 'status')).runtime, 'running');
  let repeated = 0; await startOperator(f.home, f.signal, () => repeated++); assert.equal(repeated, 1);
  assert.equal(await runSetupCli(['setup'], f.io, f.signal, f.env), 1); assert.equal(f.errors.at(-1), 'stop_operator_before_setup');
  await operatorControl(f.home, 'stop'); await running;
  assert.deepEqual(await operatorControl(f.home, 'status'), { runtime: 'stopped' });
  assert.equal(await readFile(profile, 'utf8'), 'SYNTHETIC_PROFILE');
  await writeFile(tunnel, '#!/bin/sh\nexit 1\n', { mode: 0o700 });
  await assert.rejects(startOperator(f.home, f.signal, () => {}), /operator_component_failed/);
  assert.deepEqual(await operatorControl(f.home, 'status'), { runtime: 'stopped' });
  const socket = createServer(); socket.listen(join(f.home, 'operator.sock')); await once(socket, 'listening');
  await chmod(join(f.home, 'operator.sock'), 0o600);
  await new Promise<void>(accept => socket.close(() => accept()));
  // Node removes a normal socket on close. A separate process's crashed socket is covered by CLI regression.
  await recoverOperator(f.home);
});
test('status compatibility is deliberate: no setup and explicit local config keep the legacy contract', async t => {
  const f = await fixture(t);
  assert.equal(await runHolocronCli(['init'], f.io, undefined, { env: f.env }), 0);
  f.output.length = 0;
  assert.equal(await runHolocronCli(['status'], f.io, undefined, { env: f.env }), 0);
  assert.equal(JSON.parse(f.output[0]!).localTransport, 'stopped');
  await setupMac(f.home, { '--admin-file': f.admin, '--prompt': f.prompt }, f.signal); f.output.length = 0;
  assert.equal(await runHolocronCli(['status'], f.io, undefined, { env: f.env }), 0); assert.equal(JSON.parse(f.output[0]!).setup, 'mac');
  f.output.length = 0;
  assert.equal(await runHolocronCli(['status', '--local-config', join(f.home, 'local.json')], f.io, undefined, { env: f.env }), 0);
  assert.equal(JSON.parse(f.output[0]!).localTransport, 'stopped');
});
