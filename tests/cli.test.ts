import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chmod, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { runCli } from '../src/cli-main.ts';
import { loadConfig } from '../src/config.ts';
import { localControl, startCompanion } from '../src/lifecycle.ts';
import { ShareStore } from '../src/store.ts';
import { ownerId, makeVerifier } from '../src/auth.ts';
import { ClipboardBridge } from '../src/bridge.ts';
import { temporary, memoryClipboard, literal } from './bridge-fixtures.ts';
import { config, localKeys } from './fixtures.ts';

test('local CLI reads clipboard only on capture; share/list/revoke/clear/status never mutate clipboard', async (t) => {
  const directory = await temporary(t);
  const state = join(directory, 'state');
  const configPath = join(directory, 'operator.json');
  await writeFile(configPath, JSON.stringify({ ...config, stateDirectory: state }), { mode: 0o600 });
  const adapter = memoryClipboard();
  let consumed = 0;
  const outputs: string[] = [];
  const errors: string[] = [];
  const io = { out: (line: string) => outputs.push(line), error: (line: string) => errors.push(line),
    stdin: { async *[Symbol.asyncIterator]() { consumed++; yield Buffer.from(literal); } } };
  const run = (command: string[], expected = 0) => runCli([...command, '--config', configPath], io, adapter).then((code) => assert.equal(code, expected));
  await run(['check-config']); await run(['status']); await run(['list']);
  assert.equal(consumed, 0); assert.equal(adapter.reads, 0); assert.equal(adapter.writes, 0);
  await run(['capture', '--name', 'Copied command']);
  const item = JSON.parse(outputs.at(-1)!);
  assert.equal(adapter.reads, 1);
  await run(['share-text', '--name', 'Stdin text']); assert.equal(consumed, 1);
  await run(['revoke', item.id]); assert.deepEqual(JSON.parse(outputs.at(-1)!), { revoked: true });
  await run(['clear']); assert.deepEqual(JSON.parse(outputs.at(-1)!), { cleared: 1 });
  await run(['stop']); assert.equal(JSON.parse(outputs.at(-1)!).localTransport, 'stopped');
  await run(['read-clipboard'], 2);
  await run(['capture', '--name', '../private'], 1);
  assert.equal(adapter.writes, 0);
  assert.equal(outputs.join('\n').includes(literal), false);
  assert.equal(outputs.join('\n').includes(config.ownerSubject), false);
  assert.equal(outputs.join('\n').includes(state), false);
  assert.ok(errors.length >= 2);
});

test('private config rejects symlinks, shared permissions and unexpected fields without clipboard reads', async (t) => {
  const directory = await temporary(t);
  const configPath = join(directory, 'operator.json');
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  assert.equal((await loadConfig(configPath)).writeScope, config.writeScope);
  await symlink(configPath, join(directory, 'config-link'));
  await assert.rejects(loadConfig(join(directory, 'config-link')));
  await chmod(configPath, 0o644); await assert.rejects(loadConfig(configPath));
  await chmod(configPath, 0o600);
  await writeFile(configPath, JSON.stringify({ ...config, writeScope: config.readScope })); await assert.rejects(loadConfig(configPath));
  await writeFile(configPath, JSON.stringify({ ...config, clientSecret: 'SECRET_SENTINEL' })); await assert.rejects(loadConfig(configPath));
  await chmod(directory, 0o755); await assert.rejects(loadConfig(configPath));
});

test('owner-only local lifecycle has a single runtime; stop does not clear shares or clipboard', async (t) => {
  const directory = await temporary(t);
  const store = await ShareStore.open(directory, ownerId(config));
  const adapter = memoryClipboard();
  const bridge = new ClipboardBridge(store, adapter);
  const item = store.capture(Buffer.from(literal));
  const service = await startCompanion({ ...config, port: 0 }, makeVerifier(config, localKeys), bridge);
  try {
    assert.equal((await stat(join(directory, 'control.sock'))).mode & 0o777, 0o600);
    const status = await localControl(directory, 'status'); assert.equal(status.localTransport, 'available');
    assert.equal(status.sharedItems, 1); assert.equal(status.macClipboard, 'test-adapter');
    const second = await ShareStore.open(directory, ownerId(config));
    try { assert.throws(() => second.acquireRuntime(), /already_running/); } finally { second.close(); }
    assert.equal((await localControl(directory, 'stop')).localTransport, 'stopped');
    await service.done;
    assert.equal((await localControl(directory, 'status')).localTransport, 'stopped');
    assert.equal(store.read(item.id).text, literal);
    assert.equal(adapter.reads, 0); assert.equal(adapter.writes, 0);
    const restarted = await startCompanion({ ...config, port: 0 }, makeVerifier(config, localKeys), new ClipboardBridge(store, adapter));
    await restarted.stop(); await restarted.done;
  } finally { await service.stop(); store.close(); }
});

test('concurrent local CLI processes keep immutable captures and aggregate counts durable', async (t) => {
  const directory = await temporary(t);
  const state = join(directory, 'state');
  const configPath = join(directory, 'operator.json');
  await writeFile(configPath, JSON.stringify({ ...config, stateDirectory: state }), { mode: 0o600 });
  const run = promisify(execFile);
  const processes = Array.from({ length: 6 }, (_, index) => new Promise<void>((resolvePromise, reject) => {
    const child = execFile(process.execPath, [resolve('src/cli.ts'), 'share-text', '--config', configPath, '--name', 'Concurrent ' + index],
      (error, stdout) => { if (error) reject(error); else { assert.equal(stdout.includes(literal), false); resolvePromise(); } });
    child.stdin!.end(literal);
  }));
  await Promise.all(processes);
  const store = await ShareStore.open(state, ownerId(config));
  assert.deepEqual(store.counts(), { sharedItems: 6, sharedBytes: Buffer.byteLength(literal) * 6 });
  for (const item of store.list().items) assert.equal(store.read(item.id).text, literal);
  store.close();
  const listing = await run(process.execPath, [resolve('src/cli.ts'), 'list', '--config', configPath]);
  assert.equal(JSON.parse(listing.stdout).items.length, 6);
});

test('unsafe local socket refuses lifecycle access and cleanup never follows a symlink', async (t) => {
  const directory = await temporary(t);
  const target = join(directory, 'sentinel'); await writeFile(target, 'unchanged', { mode: 0o600 });
  await symlink(target, join(directory, 'control.sock'));
  await assert.rejects(localControl(directory, 'stop'), /unsafe_control_socket/);
  const store = await ShareStore.open(directory, ownerId(config));
  await assert.rejects(startCompanion({ ...config, port: 0 }, makeVerifier(config, localKeys), new ClipboardBridge(store, memoryClipboard())), /unsafe_control_socket/);
  assert.equal(await readFile(target, 'utf8'), 'unchanged');
  store.close();
});
