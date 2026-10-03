import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, link, mkdir, readFile, readdir, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { LOGIN_LABEL, loginAction } from '../src/login.ts';
import { runCli } from '../src/cli-main.ts';
import { memoryClipboard, temporary } from './bridge-fixtures.ts';
import { config } from './fixtures.ts';

async function fixture(t: Parameters<typeof temporary>[0]) {
  const root = await temporary(t);
  const home = join(root, 'fake-home'); await mkdir(home, { mode: 0o700 });
  const node = join(root, 'node & "quoted"'); await writeFile(node, 'not executed', { mode: 0o700 });
  const cli = join(root, "cli <literal> '$(never)' &.js"); await writeFile(cli, 'not executed', { mode: 0o600 });
  const configPath = join(root, "operator & <'quoted'>.json");
  await writeFile(configPath, JSON.stringify({ ...config, stateDirectory: join(root, 'state') }), { mode: 0o600 });
  const environment = { platform: 'darwin', home, node, cli };
  const path = join(home, 'Library', 'LaunchAgents', LOGIN_LABEL + '.plist');
  return { root, environment, configPath, path };
}

test('optional login generation is private, literal, idempotent and does not start services or read a clipboard', async (t) => {
  const { root, environment, configPath, path } = await fixture(t);
  assert.equal((await loginAction('status', configPath, environment)).nextLogin, 'disabled');
  assert.deepEqual(await readdir(environment.home), []); // Status is read-only.
  const io = { stdin: { async *[Symbol.asyncIterator]() { throw Error('No stdin'); } },
    out: (_line: string) => {}, error: (line: string) => assert.fail(line) };
  const adapter = memoryClipboard();
  assert.equal(await runCli(['login-install', '--config', configPath], io, adapter, environment), 0);
  const text = await readFile(path, 'utf8');
  assert.match(text, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(text, /<key>KeepAlive<\/key><false\/>/);
  assert.match(text, /&amp;/); assert.match(text, /&lt;literal&gt;/); assert.match(text, /&quot;quoted&quot;/);
  assert.match(text, /&apos;\$\(never\)&apos;/);
  assert.equal((text.match(/<string>/g) ?? []).length, 9);
  assert.equal(text.includes(config.ownerSubject), false); assert.equal(text.includes(config.issuer), false);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  const before = await stat(path);
  const result = await loginAction('install', configPath, environment);
  assert.equal(result.currentCompanion, 'unchanged'); assert.equal(result.launchd, 'unverified');
  assert.equal((await stat(path)).mtimeMs, before.mtimeMs);
  if (process.platform === 'darwin') await promisify(execFile)('/usr/bin/plutil', ['-lint', path]);
  await assert.rejects(stat(join(root, 'state'))); // No database or local service created.
  assert.equal(adapter.reads, 0); assert.equal(adapter.writes, 0);
});

test('login removal preserves other jobs/config/files and works after installed paths/config disappear', async (t) => {
  const { environment, configPath, path } = await fixture(t);
  await loginAction('install', configPath, environment);
  const unrelated = join(environment.home, 'Library', 'LaunchAgents', 'unrelated.plist');
  await writeFile(unrelated, 'unchanged', { mode: 0o600 });
  await unlink(environment.node); await unlink(environment.cli); await unlink(configPath);
  assert.equal((await loginAction('status', configPath, environment)).nextLogin, 'enabled');
  assert.equal((await loginAction('remove', configPath, environment)).nextLogin, 'disabled');
  assert.equal((await loginAction('remove', configPath, environment)).currentCompanion, 'unchanged');
  await assert.rejects(stat(path));
  assert.equal(await readFile(unrelated, 'utf8'), 'unchanged');
});

test('same-label conflicting config, arbitrary plist edits and stale installation paths are never overwritten or removed', async (t) => {
  const { environment, configPath, path } = await fixture(t);
  await loginAction('install', configPath, environment);
  const text = await readFile(path, 'utf8');
  const otherConfig = configPath + '-other';
  await writeFile(otherConfig, JSON.stringify(config), { mode: 0o600 });
  for (const action of ['install', 'status', 'remove'] as const) {
    await assert.rejects(loginAction(action, otherConfig, environment), /login_conflict/);
  }
  const otherCli = environment.cli + '-other'; await writeFile(otherCli, 'not executed', { mode: 0o600 });
  await assert.rejects(loginAction('install', configPath, { ...environment, cli: otherCli }), /login_conflict/);
  await writeFile(path, text.replace('<false/>', '<true/>'));
  for (const action of ['install', 'status', 'remove'] as const) await assert.rejects(loginAction(action, configPath, environment), /login_conflict/);
  assert.equal(await readFile(otherConfig, 'utf8'), JSON.stringify(config));
  await writeFile(path, text);
  await loginAction('remove', configPath, { ...environment, cli: otherCli }); // Old absolute install can be removed for upgrade.
});

test('login files reject symlinks, hardlinks, shared permissions, unsafe parents and XML-invalid paths', async (t) => {
  const { root, environment, configPath, path } = await fixture(t);
  await loginAction('install', configPath, environment);
  const text = await readFile(path, 'utf8'); const sentinel = join(root, 'sentinel');
  await writeFile(sentinel, text, { mode: 0o600 });
  await unlink(path); await symlink(sentinel, path);
  await assert.rejects(loginAction('remove', configPath, environment), /login_conflict/);
  assert.equal(await readFile(sentinel, 'utf8'), text);
  await unlink(path); await link(sentinel, path);
  await assert.rejects(loginAction('remove', configPath, environment), /login_conflict/);
  await unlink(path); await writeFile(path, text, { mode: 0o644 });
  await assert.rejects(loginAction('status', configPath, environment), /login_conflict/);
  await chmod(path, 0o600);
  await chmod(join(environment.home, 'Library', 'LaunchAgents'), 0o777);
  await assert.rejects(loginAction('remove', configPath, environment), /unsafe_login_directory/);
  await chmod(join(environment.home, 'Library', 'LaunchAgents'), 0o700);
  for (const invalid of ['relative', configPath + '/../other', configPath + '\n', configPath + '\uffff', configPath + '\ud800']) {
    await assert.rejects(loginAction('remove', invalid, environment), /unsafe_login_path/);
  }
  const alias = join(root, 'home-link'); await symlink(environment.home, alias);
  await assert.rejects(loginAction('status', configPath, { ...environment, home: alias }), /unsafe_login_directory/);
});

test('login installation rejects unsupported platforms and unsafe executables/config without creating startup state', async (t) => {
  const { environment, configPath, path } = await fixture(t);
  await assert.rejects(loginAction('install', configPath, { ...environment, platform: 'linux' }), /login_requires_macos/);
  await chmod(environment.node, 0o722);
  await assert.rejects(loginAction('install', configPath, environment), /unsafe_login_executable/);
  await chmod(environment.node, 0o700);
  await chmod(configPath, 0o644);
  await assert.rejects(loginAction('install', configPath, environment));
  await chmod(configPath, 0o600);
  const nodeLink = environment.node + '-link'; await symlink(environment.node, nodeLink);
  await assert.rejects(loginAction('install', configPath, { ...environment, node: nodeLink }), /unsafe_login_executable/);
  await assert.rejects(stat(path));
  const lines: string[] = [];
  const io = { stdin: { async *[Symbol.asyncIterator]() { throw Error('No stdin'); } }, out: (line: string) => lines.push(line), error: (line: string) => lines.push(line) };
  assert.equal(await runCli(['login-install', '--config', configPath, '--force'], io, memoryClipboard(), environment), 2);
  assert.deepEqual(lines, ['invalid_arguments']);
});
