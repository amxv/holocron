import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, cp, mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { installBundle } from '../src/installation.ts';
import { localOwnerId } from '../src/local-config.ts';
import { ShareStore } from '../src/store.ts';
import { temporary } from './bridge-fixtures.ts';

const run = promisify(execFile);
async function fixture(t: Parameters<typeof temporary>[0]) {
  const root = await temporary(t); const bundle = join(root, 'package'); await mkdir(join(bundle, 'dist'), { recursive: true, mode: 0o700 });
  for (const name of ['install.js', 'installation.js', 'private-state.js']) await cp(resolve('dist', name), join(bundle, 'dist', name));
  for (const name of ['holocron.js', 'cli.js', 'cloud-cli.js']) await writeFile(join(bundle, 'dist', name), 'console.log("synthetic holocron");\n');
  await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: '@amxv/holocron', version: '0.1.1', private: true, type: 'module' }));
  const options = { prefix: join(root, "prefix ' $HOME $(never)"), bin: join(root, "bin ' $HOME $(never)"), node: process.execPath, bundle, version: '0.1.1', digest: 'a'.repeat(64) };
  return { root, bundle, options };
}

test('installer is repeatable, upgrades atomically, retains running releases and never adopts custom installs/state', async (t) => {
  const f = await fixture(t);
  const live = join(f.root, 'existing Holocron'); await mkdir(live, { mode: 0o700 });
  const config = join(live, 'local.json'); await writeFile(config, 'PRIVATE_CONFIG_SENTINEL', { mode: 0o000 });
  const store = await ShareStore.open(join(live, 'state'), localOwnerId());
  const nonce = store.acquireRuntime(); const item = store.capture(Buffer.from('existing snapshot'));
  const before = await readFile(join(live, 'state', 'bridge.sqlite'));
  try {
    assert.equal((await installBundle(f.options)).unchanged, false);
    const launcher = await readFile(join(f.options.bin, 'holocron'), 'utf8');
    assert.match(launcher, /exec '/); assert.equal((await stat(join(f.options.prefix, '.holocron-install.json'))).mode & 0o777, 0o600);
    assert.equal((await installBundle(f.options)).unchanged, true);
    assert.deepEqual(await readdir(join(f.options.prefix, 'releases')), ['0.1.1-' + 'a'.repeat(64)]);
    await assert.rejects(installBundle({ ...f.options, digest: 'b'.repeat(64) }), /different bytes/);
    await writeFile(join(f.bundle, 'package.json'), JSON.stringify({ name: '@amxv/holocron', version: '0.2.0', private: true, type: 'module' }));
    assert.equal((await installBundle({ ...f.options, version: '0.2.0', digest: 'b'.repeat(64) })).unchanged, false);
    assert.equal((await readdir(join(f.options.prefix, 'releases'))).length, 2);
    assert.equal((await run(join(f.options.bin, 'holocron'), ['--help'], { cwd: '/' })).stdout, 'synthetic holocron\n');
    assert.deepEqual(await readFile(join(live, 'state', 'bridge.sqlite')), before);
    assert.equal(store.read(item.id).text, 'existing snapshot'); assert.throws(() => store.acquireRuntime(), /already_running/);
    await chmod(config, 0o600); assert.equal(await readFile(config, 'utf8'), 'PRIVATE_CONFIG_SENTINEL');
    const custom = join(f.root, 'custom'); await mkdir(custom, { mode: 0o700 }); await writeFile(join(custom, 'keep'), 'untouched');
    await assert.rejects(installBundle({ ...f.options, prefix: custom, version: '0.2.0' }), /recognized Holocron/);
    assert.equal(await readFile(join(custom, 'keep'), 'utf8'), 'untouched');
  } finally { store.releaseRuntime(nonce); store.close(); }
});

test('conflicts, edited launchers, symlinks, shared directories and partial bundles fail without replacing or leaking staging', async (t) => {
  const f = await fixture(t); await mkdir(f.options.bin); await writeFile(join(f.options.bin, 'holocron'), 'unrelated', { mode: 0o755 });
  await assert.rejects(installBundle(f.options), /unrelated/);
  assert.equal(await readFile(join(f.options.bin, 'holocron'), 'utf8'), 'unrelated');
  assert.deepEqual(await readdir(f.options.prefix), []);
  const another = { ...f.options, bin: join(f.root, 'another-bin') }; await installBundle(another);
  await writeFile(join(another.bin, 'holocron'), 'edited', { mode: 0o755 });
  await assert.rejects(installBundle(another), /edited/);
  assert.equal(await readFile(join(another.bin, 'holocron'), 'utf8'), 'edited');
  assert.equal((await readdir(another.prefix)).some(name => name.startsWith('.staged') || name === '.install-lock'), false);
  const symlinkPrefix = join(f.root, 'linked'); await symlink(f.options.prefix, symlinkPrefix);
  await assert.rejects(installBundle({ ...f.options, prefix: symlinkPrefix }), /Unsafe state/);
  const shared = join(f.root, 'shared'); await mkdir(shared, { mode: 0o700 }); await chmod(shared, 0o777);
  await assert.rejects(installBundle({ ...f.options, prefix: shared }), /owner-only/);
  await assert.rejects(installBundle({ ...f.options, bundle: f.root }), /ENOENT/);
  const binLink = join(f.root, 'bin-link'); await symlink(f.options.bin, binLink);
  await assert.rejects(installBundle({ ...f.options, prefix: join(f.root, 'separate'), bin: binLink }), /symlink/);
  const locked = join(f.root, 'locked'); await mkdir(locked, { mode: 0o700 });
  await writeFile(join(locked, '.install-lock'), 'preserved lock', { mode: 0o600 });
  await assert.rejects(installBundle({ ...f.options, prefix: locked }), /Another installation/);
  assert.equal(await readFile(join(locked, '.install-lock'), 'utf8'), 'preserved lock');
});

test('public bootstrap checks authenticated fixed-tag origin and GitHub SHA-256, fails closed, and cleans downloads', async (t) => {
  const f = await fixture(t); const asset = join(f.root, 'holocron-0.1.1.tgz');
  await run('tar', ['-czf', asset, '-C', f.root, 'package']);
  const fakeBin = join(f.root, 'tools'); await mkdir(fakeBin); const downloads = join(f.root, 'downloads'); await mkdir(downloads);
  const events = join(f.root, 'events');
  await writeFile(join(fakeBin, 'gh'), `#!/usr/bin/env node
import { appendFileSync, copyFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const args = process.argv.slice(2); appendFileSync(process.env.TEST_EVENTS, JSON.stringify(args) + '\\n');
if (process.env.TEST_GH_FAIL === '1') process.exit(1);
const bytes = readFileSync(process.env.TEST_ASSET); const digest = createHash('sha256').update(bytes).digest('hex');
if (args[0] === 'api') console.log(JSON.stringify({ tag_name: process.env.TEST_BAD_TAG ? 'other' : 'holocron-v0.1.1', draft: Boolean(process.env.TEST_DRAFT), assets: [{name:'holocron-0.1.1.tgz', size: bytes.length + (process.env.TEST_BAD_SIZE ? 1 : 0), digest: process.env.TEST_MISSING_DIGEST ? null : 'sha256:' + (process.env.TEST_BAD_DIGEST ? '0'.repeat(64) : digest)}]}));
else if (args[1] === 'download') copyFileSync(process.env.TEST_ASSET, join(args[args.indexOf('--dir') + 1], 'holocron-0.1.1.tgz'));
else if (args[1] === 'verify-asset') process.exit(process.env.TEST_ATTESTATION_FAIL ? 1 : 0);
else process.exit(1);
`, { mode: 0o755 });
  const env = { ...process.env, PATH: fakeBin + ':' + process.env.PATH, TMPDIR: downloads,
    TEST_ASSET: asset, TEST_EVENTS: events };
  const shell = resolve('site/public/install.sh'); assert.match(await readFile(shell, "utf8"), /^holocron_version=0\.3\.1$/m);
  const args = [shell, "--version", "0.1.1", '--prefix', f.options.prefix, '--bin-dir', f.options.bin];
  assert.match((await run('sh', args, { env, cwd: '/' })).stdout, /Holocron 0.1.1 installed/);
  assert.match((await run('sh', args, { env, cwd: '/' })).stdout, /already installed/);
  for (const extra of [{ TEST_BAD_DIGEST: '1' }, { TEST_GH_FAIL: '1' }, { TEST_BAD_SIZE: '1' }, { TEST_BAD_TAG: '1' }, { TEST_DRAFT: '1' }, { TEST_MISSING_DIGEST: '1' }]) {
    await assert.rejects(run('sh', args, { env: { ...env, ...extra } }), /integrity|Release unavailable/);
  }
  await assert.rejects(run('sh', [...args, '--attestation'], { env: { ...env, TEST_ATTESTATION_FAIL: '1' } }), /attestation/);
  await symlink('/not-followed', join(f.bundle, 'unsafe-link'));
  const unsafe = join(f.root, 'unsafe.tgz'); await run('tar', ['-czf', unsafe, '-C', f.root, 'package']);
  await assert.rejects(run('sh', args, { env: { ...env, TEST_ASSET: unsafe } }), /Unsafe archive entry types/);
  assert.deepEqual(await readdir(downloads), []);
  const calls = (await readFile(events, 'utf8')).trim().split('\n').map(value => JSON.parse(value));
  assert.deepEqual(calls[0], ['api', '--hostname', 'github.com', 'repos/amxv/holocron/releases/tags/holocron-v0.1.1']);
  assert.equal(calls.some(value => value.includes('--repo') && value.includes('github.com/amxv/holocron')), true);
  assert.equal((await readdir(f.options.prefix)).includes('.install-lock'), false);
});
