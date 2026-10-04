import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]))).flat();
}
const code = (await Promise.all(['src', 'tests', 'scripts', 'raycast/src', 'raycast/tests'].map(files))).flat().filter((path) => /\.(?:ts|mjs)$/.test(path));
for (const path of code) {
  const text = await readFile(path, 'utf8');
  assert.ok(text.split('\n').length <= 1001, `${path} exceeds 1000 lines`);
}
const maintained = [...await files('src'), ...await files('docs'), ...await files('plugins'), ...await files('native'), 'README.md', 'package.json', 'package-lock.json'];
for (const path of (await files('native')).filter(path => path.endsWith('.swift'))) assert.ok((await readFile(path, 'utf8')).split('\n').length <= 1001, `${path} exceeds 1000 lines`);
assert.deepEqual(await readFile('native/HolocronIcon.svg'), await readFile('site/public/favicon.svg'));
assert.deepEqual((await readFile('native/HolocronIcon.png')).subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
for (const path of maintained) {
  const text = await readFile(path, 'utf8');
  assert.doesNotMatch(text, /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|sk-(?:proj|svcacct)-|\/Users\/|plugin_asdk_app_[A-Za-z0-9]+|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/);
}
const manifest = JSON.parse(await readFile('plugins/holocron/plugin.json', 'utf8'));
assert.deepEqual(manifest.extensions['com.openai'].interface.capabilities, ['Read', 'Write']);
assert.deepEqual(JSON.parse(await readFile('plugins/holocron/.app.json', 'utf8')), { apps: {} });
assert.match(await readFile('README.md', 'utf8'), /deferred and unverified/);
assert.match(await readFile('docs/text-bridge.md', 'utf8'), /never access an existing OS clipboard/);
for (const path of ['src/cloud-clipboard.ts', 'src/cloud-cli-main.ts', 'src/cloud-cli.ts', 'src/cloud-input.ts', 'src/cloud-process.ts']) {
  const text = await readFile(path, 'utf8');
  assert.doesNotMatch(text, /from ['"](?:node:(?:http|https|net|tls)|\.\/(?:auth|config|http|lifecycle|private-state))|\bfetch\(/);
}
assert.match(await readFile('docs/cloud-clipboard.md', 'utf8'), /deferred and unverified/);
const packageManifest = JSON.parse(await readFile('package.json', 'utf8'));
assert.equal(packageManifest.bin['shared-clipboard-cloud'], 'dist/cloud-cli.js');
assert.equal(packageManifest.name, '@amxv/holocron');
assert.equal(manifest.name, 'holocron'); assert.equal(manifest.version, packageManifest.version);
assert.equal(packageManifest.bin.holocron, 'dist/holocron.js');
assert.equal(packageManifest.bin.board, 'dist/board.js');
assert.deepEqual(packageManifest.files, ['dist', 'plugins/holocron', 'docs', 'README.md', 'native']);
const raycast = JSON.parse(await readFile('raycast/package.json', 'utf8'));
assert.equal(raycast.name, 'holocron'); assert.equal(raycast.title, 'Holocron');
assert.equal(raycast.owner, 'zue-ai'); assert.equal(raycast.access, 'private');
assert.equal(raycast.icon, 'icon.png');
assert.deepEqual(raycast.commands.map(({ name }) => name), ['share-clipboard', 'share-finder-file']);
assert.equal(packageManifest.private, true);
assert.equal(packageManifest.engines.node, '24.21.0');
assert.equal(packageManifest.packageManager, 'bun@1.4.0');
const lockfile = JSON.parse(await readFile('package-lock.json', 'utf8'));
assert.deepEqual(lockfile.packages[''].bin, packageManifest.bin);
assert.equal(await readFile('src/version.ts', 'utf8'), `export const VERSION = '${packageManifest.version}';\n`);
assert.equal(lockfile.version, packageManifest.version);
assert.equal(lockfile.packages[''].version, packageManifest.version);
assert.match(await readFile('site/public/install.sh', 'utf8'), new RegExp('^holocron_version=' + packageManifest.version.replaceAll('.', '\\.') + '$', 'm'));
for (const dir of ['site', 'raycast']) {
  const p = JSON.parse(await readFile(dir + '/package.json', 'utf8'));
  const lock = JSON.parse(await readFile(dir + '/package-lock.json', 'utf8'));
  assert.equal(p.version, packageManifest.version);
  assert.equal(p.packageManager, packageManifest.packageManager);
  assert.equal(lock.version, p.version); assert.equal(lock.packages[''].version, p.version);
  assert.ok((await readFile(dir + '/bun.lock', 'utf8')).length > 0);
}
assert.ok((await readFile('bun.lock', 'utf8')).length > 0);
const loginSource = await readFile('src/login.ts', 'utf8');
assert.doesNotMatch(loginSource, /node:child_process|\bspawn\(|\bexecFile\(|\bprocess\.kill\(/);
assert.match(await readFile('docs/operations.md', 'utf8'), /KeepAlive=false/);
console.log(`Source/docs/package scaffold checks passed; ${code.length} code files meet the 1000-line limit.`);
