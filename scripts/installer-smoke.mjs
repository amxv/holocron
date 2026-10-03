import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const temporary = await mkdtemp(join(await realpath('/tmp'), 'board-installer-smoke-'));
try {
  const output = join(temporary, 'artifacts');
  execFileSync(process.execPath, ['scripts/release-bundle.mjs', output], { stdio: 'inherit' });
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  const name = `board-${manifest.version}.tgz`; const asset = join(output, name);
  const bytes = await readFile(asset); const digest = createHash('sha256').update(bytes).digest('hex');
  assert.equal(await readFile(join(output, 'SHA256SUMS'), 'utf8'), `${digest}  ${name}\n`);
  const home = join(temporary, 'home'); const tools = join(temporary, 'tools');
  await mkdir(home, { mode: 0o700 }); await mkdir(tools, { mode: 0o700 });
  // Authenticated-origin transport is injected; never call the real gh or inspect credentials.
  await writeFile(join(tools, 'gh'), `#!/usr/bin/env node
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
if (args[0] === 'api') console.log(JSON.stringify({tag_name:'board-v${manifest.version}',draft:false,assets:[{name:${JSON.stringify(name)},size:${bytes.length},digest:'sha256:${digest}'}]}));
else if (args[1] === 'download') copyFileSync(${JSON.stringify(asset)}, join(args[args.indexOf('--dir') + 1], ${JSON.stringify(name)}));
else process.exit(1);
`, { mode: 0o755 });
  const env = { PATH: tools + ':' + process.env.PATH, HOME: home, TMPDIR: temporary };
  const install = () => execFileSync('sh', [resolve('site/public/install.sh')], { cwd: '/', env, encoding: 'utf8' });
  assert.match(install(), /installed/); assert.match(install(), /already installed/);
  const board = join(home, '.local/bin/board');
  const cli = (args, input) => execFileSync(board, args, { cwd: home, env, encoding: 'utf8', ...(input !== undefined ? { input } : {}) });
  assert.equal(cli(['--version']).trim(), manifest.version);
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
  const marker = JSON.parse(await readFile(join(home, '.local/share/board-cli/.board-install.json'), 'utf8'));
  for (const absent of ['typescript', '@types/node']) {
    await assert.rejects(readFile(join(marker.release, 'node_modules', absent, 'package.json')));
  }
  for (const legacy of ['cli.js', 'cloud-cli.js']) {
    assert.match(execFileSync(process.execPath, [join(marker.release, 'dist', legacy), '--help'], { encoding: 'utf8', env }), /Usage:/);
  }
  assert.equal((await readdir(temporary)).some(entry => entry.startsWith('board-install.')), false);
  console.log('Verified production-bundle installation smoke passed: no-op reinstall, isolated init/link, exact stdin/file digests, metadata/revoke/clear, retained aliases and no development dependencies.');
} finally { await rm(temporary, { recursive: true, force: true }); }
