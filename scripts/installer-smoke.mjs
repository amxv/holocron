import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile, symlink, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pairings } from '../tests/secret-fixtures.ts';

const temporary = await mkdtemp(join(await realpath('/tmp'), 'holocron-installer-smoke-'));
try {
  const output = join(temporary, 'artifacts');
  execFileSync(process.execPath, ['scripts/release-bundle.mjs', output], { stdio: 'inherit' });
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  const name = `holocron-${manifest.version}.tgz`; const asset = join(output, name);
  const bytes = await readFile(asset); const digest = createHash('sha256').update(bytes).digest('hex');
  assert.equal(await readFile(join(output, 'SHA256SUMS'), 'utf8'), `${digest}  ${name}\n`);
  const home = join(temporary, 'home'); const tools = join(temporary, 'tools');
  await mkdir(home, { mode: 0o700 }); await mkdir(tools, { mode: 0o700 });
  const oldPrefix = join(home, '.local/share/board-cli'); const oldBin = join(home, '.local/bin/board');
  await mkdir(oldPrefix, { recursive: true, mode: 0o700 });
  await mkdir(join(home, '.local/bin'), { recursive: true, mode: 0o700 });
  const oldMarker = '{"original":"Board 0.1.0 installation, preserve exactly"}\n';
  const oldLauncher = '#!/bin/sh\n# Existing pinned Board launcher, preserve exactly.\n';
  await writeFile(join(oldPrefix, '.board-install.json'), oldMarker, { mode: 0o600 });
  await writeFile(oldBin, oldLauncher, { mode: 0o755 });
  // Authenticated-origin transport is injected; never call the real gh or inspect credentials.
  await writeFile(join(tools, 'gh'), `#!/usr/bin/env node
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
if (args[0] === 'auth') process.exit(process.env.HOLOCRON_FIXTURE_AUTH_FAIL ? 1 : 0);
else if (args[0] === 'api') console.log(JSON.stringify({tag_name:'holocron-v${manifest.version}',draft:false,assets:[{name:${JSON.stringify(name)},size:${bytes.length},digest:'sha256:${digest}'}]}));
else if (args[1] === 'download') copyFileSync(${JSON.stringify(asset)}, join(args[args.indexOf('--dir') + 1], ${JSON.stringify(name)}));
else process.exit(1);
`, { mode: 0o755 });
  const env = { PATH: tools + ':' + process.env.PATH, HOME: home, TMPDIR: temporary };
  const install = () => execFileSync('sh', [resolve('site/public/install.sh')], { cwd: '/', env, encoding: 'utf8' });
  assert.match(install(), /installed/); assert.match(install(), /already installed/);
  assert.equal(await readFile(join(oldPrefix, '.board-install.json'), 'utf8'), oldMarker);
  assert.equal(await readFile(oldBin, 'utf8'), oldLauncher);
  const holocron = join(home, '.local/bin/holocron');
  const cli = (args, input) => execFileSync(holocron, args, { cwd: home, env, encoding: 'utf8', ...(input !== undefined ? { input } : {}) });
  assert.equal(cli(['--version']).trim(), manifest.version);
  assert.match(cli(['secrets', '--help']), /dedicated encrypted relay/);
  assert.match(cli(['ask', '--help']), /private temporary directory/);
  assert.match(cli(['--help']), /Snapshots do not populate another computer/);
  assert.deepEqual(JSON.parse(cli(['init'])), { initialized: true });
  const literal = '\ufeffSnow 雪 🚀 "quotes" \'single\' `backticks` $(never-execute) $HOME\r\nnew line\n';
  const item = JSON.parse(cli(['share', '--name', 'Installed stdin'], literal));
  assert.equal(item.sha256, createHash('sha256').update(literal).digest('hex'));
  const selected = join(home, '`literal` $(never) $HOME.txt'); await writeFile(selected, literal);
  const file = JSON.parse(cli(['share-file', './`literal` $(never) $HOME.txt']));
  assert.equal(file.sha256, item.sha256);
  assert.equal(JSON.parse(cli(['list'])).items.length, 2);
  assert.equal(JSON.parse(cli(['revoke', item.id])).revoked, true);
  assert.equal(JSON.parse(cli(['clear'])).cleared, 1);
  const marker = JSON.parse(await readFile(join(home, '.local/share/holocron-cli/.holocron-install.json'), 'utf8'));
  for (const absent of ['typescript', '@types/node']) {
    await assert.rejects(readFile(join(marker.release, 'node_modules', absent, 'package.json')));
  }
  for (const absent of ['site', 'raycast']) await assert.rejects(readFile(join(marker.release, absent, 'package.json')));
  for (const legacy of ['board.js', 'cli.js', 'cloud-cli.js']) {
    assert.match(execFileSync(process.execPath, [join(marker.release, 'dist', legacy), '--help'], { encoding: 'utf8', env }), /Usage:/);
  }
  assert.equal((await readdir(temporary)).some(entry => entry.startsWith('holocron-install.')), false);
  if (process.platform === 'darwin') {
    // The published 0.3.0 failure was a package-manager symlink rejected as a
    // native helper. Exercise the actual installed CLI, default Swift build,
    // setup rollback and repeatable binding without touching any live config.
    const macHome = join(home, 'mac-profile'); await mkdir(macHome, { mode: 0o700 });
    const admin = join(macHome, 'admin'); await writeFile(admin, Buffer.alloc(32, 7).toString('base64url'), { mode: 0o600 });
    const local = join(macHome, 'board-local.json'); const localBytes = JSON.stringify({ transport: 'stdio', stateDirectory: join(macHome, 'board-state') });
    const tunnelProfile = join(macHome, 'board.yaml'); await writeFile(tunnelProfile, 'SYNTHETIC_PROFILE', { mode: 0o600 });
    const tunnelTarget = join(tools, 'tunnel-real'); await writeFile(tunnelTarget, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const tunnelAlias = join(tools, 'tunnel-client'); await symlink(tunnelTarget, tunnelAlias);
    const setupArgs = ['setup', '--admin-file', admin, '--local-config', local, '--tunnel-profile', tunnelProfile, '--tunnel-client', tunnelAlias];
    const macCli = () => execFileSync(holocron, setupArgs, { cwd: '/', env: { ...env, HOLOCRON_CLI_HOME: macHome }, encoding: 'utf8', stdio: 'pipe' });
    await writeFile(local, '{}', { mode: 0o600 });
    assert.throws(macCli, /setup_operation_failed/);
    assert.equal((await readdir(macHome)).includes('native-prompt-v3'), false);
    assert.equal((await readdir(macHome)).includes('setup.lock'), false);
    await writeFile(local, localBytes, { mode: 0o600 });
    assert.match(macCli(), /Mac setup saved/);
    const setupPath = join(macHome, 'setup.json'); const setupBefore = await readFile(setupPath);
    const setup = JSON.parse(setupBefore.toString('utf8'));
    assert.equal(setup.tunnelClient, tunnelTarget);
    assert.equal(setup.prompt, join(macHome, 'native-prompt-v3/holocron-secrets-ui'));
    assert.equal((await stat(setup.prompt)).mode & 0o777, 0o700);
    assert.match(macCli(), /Mac setup saved/); assert.deepEqual(await readFile(setupPath), setupBefore);
    assert.equal(await readFile(local, 'utf8'), localBytes); assert.equal(await readFile(tunnelProfile, 'utf8'), 'SYNTHETIC_PROFILE');
    assert.equal((await readdir(macHome)).includes('setup.lock'), false);
    console.log('Installed Mac setup regression passed: tunnel alias resolves to guarded target, native helper builds automatically, failure removes owned helper/lock, repeat setup preserves Board references.');
  }
  // Execute the actual public setup shell and installed Node CLI with Linux's
  // platform branches selected. This is not an actual Linux kernel/ABI test.
  const receiverProfile = join(home, 'receiver-profile'); await mkdir(receiverProfile, { mode: 0o700 });
  const receiverConfig = join(receiverProfile, 'receiver.json');
  await writeFile(receiverConfig, JSON.stringify(pairings().receiver), { mode: 0o600 });
  const setupBytes = JSON.stringify({ version: 1, role: 'receiver', relay: 'https://holocron.invalid/api/secrets', macConfigs: [], receiverConfig });
  await writeFile(join(receiverProfile, 'setup.json'), setupBytes, { mode: 0o600 });
  await writeFile(join(tools, 'uname'), `#!/bin/sh\ncase "$1" in -s) echo Linux;; -m) echo x86_64;; *) exit 1;; esac\n`, { mode: 0o755 });
  await writeFile(join(tools, 'stat'), `#!${process.execPath}\nimport {statSync} from 'node:fs';const s=statSync(process.argv.at(-1));console.log(s.uid+' '+(s.mode&0o777).toString(8));\n`, { mode: 0o755 });
  await writeFile(join(tools, 'curl'), `#!${process.execPath}
import {copyFileSync,writeFileSync} from 'node:fs';
const a=process.argv.slice(2);const output=a[a.indexOf('-o')+1];
if(a.includes('https://holocron.ashray.xyz/install.sh')) copyFileSync(${JSON.stringify(resolve('site/public/install.sh'))},output);
else if(a.some(v=>v.startsWith('https://nodejs.org/dist/v24.21.0/'))) writeFileSync(output,'synthetic bad digest');
else process.exit(1);
`, { mode: 0o755 });
  const setupEnv = { ...env, HOLOCRON_CLI_HOME: receiverProfile };
  const bootstrap = (extra = {}) => execFileSync('sh', [resolve('site/public/setup.sh'), 'receiver', '--code', 'IGNORED_SAVED_PAIRING'], { cwd: '/', env: { ...setupEnv, ...extra }, encoding: 'utf8' });
  assert.match(bootstrap(), /Receiver already paired/); assert.match(bootstrap(), /Receiver already paired/);
  assert.equal(await readFile(join(receiverProfile, 'setup.json'), 'utf8'), setupBytes);
  assert.throws(() => bootstrap({ HOLOCRON_FIXTURE_AUTH_FAIL: '1' }), /device owner run/);
  await writeFile(join(tools, 'node'), `#!/bin/sh\nif [ "$1" = --version ]; then echo v0.0.0; else exec '${process.execPath.replaceAll("'", "'\\''")}' "$@"; fi\n`, { mode: 0o755 });
  assert.throws(() => bootstrap(), /Node integrity check failed/);
  const unrecognized = join(home, '.local/share/holocron-tools/node-24.21.0');
  await mkdir(join(unrecognized, 'bin'), { recursive: true, mode: 0o700 });
  await writeFile(join(unrecognized, 'bin/node'), '#!/bin/sh\necho v24.21.0\n', { mode: 0o700 });
  assert.throws(() => bootstrap(), /Unrecognized managed prerequisite/);
  assert.equal(await readFile(join(unrecognized, 'bin/node'), 'utf8'), '#!/bin/sh\necho v24.21.0\n');
  await rm(unrecognized, { recursive: true });
  await rm(join(tools, 'node')); assert.match(bootstrap(), /Receiver already paired/);
  assert.equal((await readdir(temporary)).some(entry => entry.startsWith('holocron-setup.') || entry.startsWith('holocron-install.')), false);
  assert.equal(await readFile(join(oldPrefix, '.board-install.json'), 'utf8'), oldMarker);
  assert.equal(await readFile(oldBin, 'utf8'), oldLauncher);
  console.log('Linux-branch public setup regressions passed: saved pairing, reentry, device-login boundary, failed prerequisite integrity, cleanup and retained Board state. Actual Linux execution requires a reachable Linux host.');
  console.log('Verified production-bundle installation smoke passed: no-op reinstall, isolated init/link, exact stdin/file digests, metadata/revoke/clear, retained aliases and no development dependencies.');
} finally { await rm(temporary, { recursive: true, force: true }); }
