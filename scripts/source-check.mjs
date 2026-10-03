import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]))).flat();
}
const code = (await Promise.all(['src', 'tests', 'scripts'].map(files))).flat().filter((path) => /\.(?:ts|mjs)$/.test(path));
for (const path of code) {
  const text = await readFile(path, 'utf8');
  assert.ok(text.split('\n').length <= 1001, `${path} exceeds 1000 lines`);
}
const maintained = [...await files('src'), ...await files('docs'), ...await files('plugins'), 'README.md', 'package.json'];
for (const path of maintained) {
  const text = await readFile(path, 'utf8');
  assert.doesNotMatch(text, /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|sk-(?:proj|svcacct)-|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/);
}
const manifest = JSON.parse(await readFile('plugins/shared-clipboard/plugin.json', 'utf8'));
assert.deepEqual(manifest.extensions['com.openai'].interface.capabilities, ['Read', 'Write']);
assert.deepEqual(JSON.parse(await readFile('plugins/shared-clipboard/.app.json', 'utf8')), { apps: {} });
assert.match(await readFile('README.md', 'utf8'), /deferred and unverified/);
assert.match(await readFile('docs/text-bridge.md', 'utf8'), /never access an existing OS clipboard/);
console.log(`Source/docs/package scaffold checks passed; ${code.length} code files meet the 1000-line limit.`);
