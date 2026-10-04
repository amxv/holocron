import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { runHolocronCli } from '../src/holocron-main.ts';
import { localOwnerId } from '../src/local-config.ts';
import { ShareStore } from '../src/store.ts';
import { literal, memoryClipboard, temporary } from './bridge-fixtures.ts';

async function fixture(t: Parameters<typeof temporary>[0]) {
  const root = await temporary(t); const config = join(root, 'local.json'); const state = join(root, 'state');
  await writeFile(config, JSON.stringify({ transport: 'stdio', stateDirectory: state }), { mode: 0o600 });
  const lines: string[] = []; const errors: string[] = []; const adapter = memoryClipboard();
  const io = { stdin: (async function* () { yield Buffer.from(literal); })(),
    out: (line: string) => lines.push(line), error: (line: string) => errors.push(line) };
  const env = { BOARD_CLI_HOME: join(root, 'profile') };
  return { root, config, state, lines, errors, adapter, io, env };
}

test('friendly copy/share contract preserves literal bytes, metadata and existing STDIO ownership', async (t) => {
  const f = await fixture(t);
  const run = (args: string[]) => runHolocronCli(args, f.io, f.adapter, { env: f.env });
  assert.equal(await run(['link', '--local-config', f.config]), 0);
  assert.equal((await stat(join(f.env.BOARD_CLI_HOME, 'cli.json'))).mode & 0o777, 0o600);
  await assert.rejects(stat(f.state)); // Linking never opens runtime state.
  assert.equal(await run(['copy', '--name', 'Raycast clipboard']), 0);
  const item = JSON.parse(f.lines.at(-1)!);
  assert.equal(item.kind, 'text'); assert.equal(item.byteCount, Buffer.byteLength(literal));
  assert.equal(item.name, 'Raycast clipboard'); assert.equal(Date.parse(item.expiresAt) - Date.parse(item.createdAt), 86400000);
  assert.equal(await run(['share', '--name', 'Literal stdin']), 0);
  const store = await ShareStore.open(f.state, localOwnerId());
  try { assert.deepEqual(Buffer.from(store.read(item.id).text), Buffer.from(literal)); assert.equal(store.counts().sharedItems, 2); }
  finally { store.close(); }
  assert.equal(await run(['list']), 0);
  assert.equal(await run(['revoke', item.id]), 0);
  assert.equal(await run(['clear']), 0);
  assert.equal(f.adapter.reads, 1); assert.equal(f.adapter.writes, 0);
  assert.equal(f.lines.join('\n').includes(literal), false); assert.equal(f.lines.join('\n').includes(f.config), false);
  assert.deepEqual(f.errors, []);
});

test('init refuses existing config; overrides are explicit and OAuth/lifecycle/shell boundaries remain closed', async (t) => {
  const f = await fixture(t);
  const run = (args: string[], env: NodeJS.ProcessEnv = f.env) => runHolocronCli(args, f.io, f.adapter, { env });
  assert.equal(await run(['init']), 0);
  const profile = await readFile(join(f.env.BOARD_CLI_HOME, 'cli.json'));
  assert.equal(await run(['init']), 1);
  assert.deepEqual(await readFile(join(f.env.BOARD_CLI_HOME, 'cli.json')), profile);
  const override = { ...f.env, BOARD_LOCAL_CONFIG: f.config };
  assert.equal(await run(['copy'], override), 0); assert.equal(f.adapter.reads, 1);
  assert.equal(await run(['list', '--local-config', f.config], { ...f.env, BOARD_LOCAL_CONFIG: '/nonexistent' }), 0);
  assert.equal(await run(['start']), 1); // The new owned lifecycle requires explicit saved setup.
  for (const args of [['login-install'], ['exec', literal],
    ['copy', '--local-config', f.config, '--local-config', f.config], ['link'], ['copy', '--local-config']]) {
    assert.equal(await run(args), 2);
  }
  assert.equal(await run(['copy', '--config', f.config]), 1); // Local config cannot grant HTTP authority.
  assert.equal(await run(['stop', '--local-config', f.config]), 0);
  assert.equal(await run(['copy', '--name', '../unsafe']), 1);
  assert.equal(f.adapter.reads, 1); assert.equal(f.adapter.writes, 0);
  await chmod(f.config, 0o644); assert.equal(await run(['link', '--local-config', f.config]), 1);
  await chmod(f.config, 0o600);
  await symlink(f.config, join(f.root, 'config-link'));
  assert.equal(await run(['link', '--local-config', join(f.root, 'config-link')]), 1);
});

test('installed holocron entrypoint works from root/home/state and resolves literal selected paths before anchoring cwd', async (t) => {
  const f = await fixture(t); const run = promisify(execFile); const entry = resolve('dist/holocron.js');
  const file = '`quotes` $(never) $HOME.txt'; await writeFile(join(f.root, file), literal);
  const env = { PATH: process.env.PATH, HOME: f.root, BOARD_LOCAL_CONFIG: f.config };
  for (const cwd of ['/', f.root]) {
    const listed = await run(process.execPath, [entry, 'list'], { cwd, env });
    assert.equal(JSON.parse(listed.stdout).items.length, 0);
  }
  const shared = await run(process.execPath, [entry, 'share-file', file, '--name', 'Selected file'], { cwd: f.root, env });
  const item = JSON.parse(shared.stdout);
  const listing = await run(process.execPath, [entry, 'list'], { cwd: f.state, env });
  assert.equal(JSON.parse(listing.stdout).items.some((value: { id: string }) => value.id === item.id), true);
  const store = await ShareStore.open(f.state, localOwnerId());
  try { assert.equal(store.read(item.id).text, literal); } finally { store.close(); }
  // Direct old CLI still enforces its original working-directory guard.
  await assert.rejects(run(process.execPath, [resolve('dist/cli.js'), 'list', '--local-config', f.config], { cwd: f.root, env }));
  await mkdir(join(f.root, 'cloud'), { mode: 0o700 });
  const calls: string[][] = [];
  assert.equal(await runHolocronCli(['cloud', 'write', '--sha256', 'a'.repeat(64), '--file', file], f.io, f.adapter, {
    selectedDirectory: f.root, env: { BOARD_CLI_HOME: '/nonexistent' },
    cloud: async (args) => { calls.push(args); return 0; },
  }), 0);
  assert.equal(calls[0]!.at(-1), join(f.root, file));
});

test('friendly sharing rejects invalid/oversize bytes without clipboard writes or snapshots', async (t) => {
  const f = await fixture(t);
  for (const bytes of [Buffer.from([0xff]), Buffer.alloc(262145)]) {
    const io = { ...f.io, stdin: (async function* () { yield bytes; })() };
    assert.equal(await runHolocronCli(['share', '--local-config', f.config], io, f.adapter), 1);
  }
  assert.equal(await runHolocronCli(['share', '--local-config', f.config], { ...f.io, stdin: (async function* () {})() }, f.adapter), 0);
  assert.equal(JSON.parse(f.lines.at(-1)!).byteCount, 0);
  const store = await ShareStore.open(f.state, localOwnerId());
  try { assert.equal(store.counts().sharedItems, 1); } finally { store.close(); }
  assert.equal(f.adapter.reads, 0); assert.equal(f.adapter.writes, 0);
});
