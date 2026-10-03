import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preparePlugin } from '../src/plugin.ts';

test('registered mapping is opt-in and never overwrites another plugin or config', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'clipboard-plugin-test-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const output = join(temporary, 'plugin');
  const syntheticId = 'plugin_asdk_app_SYNTHETICTESTONLY';
  await preparePlugin(syntheticId, output);
  const manifest = JSON.parse(await readFile(join(output, 'plugin.json'), 'utf8'));
  assert.equal(manifest.extensions['com.openai'].apps, './.app.json');
  assert.deepEqual(JSON.parse(await readFile(join(output, '.app.json'), 'utf8')), {
    apps: { 'shared-clipboard-probe': { id: syntheticId } },
  });
  assert.equal((await stat(output)).mode & 0o777, 0o700);
  assert.equal((await stat(join(output, '.app.json'))).mode & 0o777, 0o600);
  await assert.rejects(preparePlugin('plugin_asdk_app_OTHER', output));
  for (const id of ['', 'connector_fake', 'plugin_asdk_app_../../bad', 'plugin_asdk_app_fake\n']) {
    await assert.rejects(preparePlugin(id, join(temporary, 'invalid')));
  }
  assert.ok((await readFile(join(output, '.app.json'), 'utf8')).includes(syntheticId));
});

test('committed scaffold has accurate explicit Read/Write metadata and no invented connection', async () => {
  const manifest = JSON.parse(await readFile(new URL('../plugins/shared-clipboard/plugin.json', import.meta.url), 'utf8'));
  assert.equal(manifest.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.equal(manifest.name, 'shared-clipboard-probe');
  assert.deepEqual(manifest.extensions['com.openai'].interface.capabilities, ['Read', 'Write']);
  assert.deepEqual(JSON.parse(await readFile(new URL('../plugins/shared-clipboard/.app.json', import.meta.url), 'utf8')), { apps: {} });
});
