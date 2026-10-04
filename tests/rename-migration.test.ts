import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { temporary } from './bridge-fixtures.ts';
import { localOwnerId } from '../src/local-config.ts';
import { ShareStore } from '../src/store.ts';
import { loginAction, LOGIN_LABEL } from '../src/login.ts';
import { config } from './fixtures.ts';

const run = promisify(execFile);
test('Holocron and retained Board entrypoints reuse the legacy profile, owner, shares, receipts and active lease', async (t) => {
  const home = await temporary(t);
  const profile = join(home, '.config', 'board'); await mkdir(profile, { recursive: true, mode: 0o700 });
  const privateHome = join(home, 'original-private'); await mkdir(privateHome, { mode: 0o700 });
  const local = join(privateHome, 'local.json'); const state = join(privateHome, 'state');
  const configBytes = JSON.stringify({ transport: 'stdio', stateDirectory: state }) + '\n';
  const linkBytes = JSON.stringify({ localConfig: local }) + '\n';
  await writeFile(local, configBytes, { mode: 0o600 });
  await writeFile(join(profile, 'cli.json'), linkBytes, { mode: 0o600 });
  const legacyOwner = createHash('sha256').update(JSON.stringify(['shared-clipboard-local-stdio-v1', process.getuid!()])).digest('hex');
  assert.equal(localOwnerId(), legacyOwner);
  const store = await ShareStore.open(state, legacyOwner);
  const item = store.capture(Buffer.from('existing snapshot'));
  const request = 'legacy_completed_receipt_01';
  store.beginReceipt(request, 'a'.repeat(64), new Date(Date.now() + 60000).toISOString(), 17);
  const receipt = store.finishReceipt(request, 'completed'); const nonce = store.acquireRuntime();
  const env = { PATH: process.env.PATH, HOME: home };
  try {
    for (const entry of ['holocron.js', 'board.js']) {
      const listed = await run(process.execPath, [resolve('dist', entry), 'list'], { cwd: '/', env });
      assert.equal(JSON.parse(listed.stdout).items[0].id, item.id);
      await assert.rejects(run(process.execPath, [resolve('dist', entry), 'init'], { cwd: '/', env }));
    }
    const direct = await run(process.execPath, [resolve('dist/cli.js'), 'list', '--local-config', local], { cwd: resolve('dist'), env });
    assert.equal(JSON.parse(direct.stdout).items[0].id, item.id);
    assert.deepEqual(store.publicReceipt(store.receipt(request)!), receipt);
    assert.throws(() => store.acquireRuntime(), /already_running/);
    assert.equal(await readFile(local, 'utf8'), configBytes);
    assert.equal(await readFile(join(profile, 'cli.json'), 'utf8'), linkBytes);
    await assert.rejects(stat(join(home, '.config', 'holocron')));
    // Both current environment names override legacy names without copying the old profile.
    const modern = join(home, 'modern');
    const overrides = { ...env, HOLOCRON_CLI_HOME: modern, BOARD_CLI_HOME: '/not-used',
      HOLOCRON_LOCAL_CONFIG: local, BOARD_LOCAL_CONFIG: '/not-used' };
    const listed = await run(process.execPath, [resolve('dist/holocron.js'), 'list'], { cwd: '/', env: overrides });
    assert.equal(JSON.parse(listed.stdout).items[0].id, item.id);
    await assert.rejects(stat(modern));
  } finally { store.releaseRuntime(nonce); store.close(); }
});

test('HTTP default state uses the original directory in place, and a fresh home uses Holocron', async (t) => {
  const home = await temporary(t); const legacy = join(home, 'Library', 'Application Support', 'shared-clipboard');
  await mkdir(legacy, { recursive: true, mode: 0o700 });
  const source = `import { stateDirectory } from ${JSON.stringify(new URL('../dist/private-state.js', import.meta.url).href)}; console.log(await stateDirectory());`;
  const env = { PATH: process.env.PATH, HOME: home };
  assert.equal((await run(process.execPath, ['--input-type=module', '-e', source], { cwd: resolve('dist'), env })).stdout.trim(), legacy);
  await rename(legacy, legacy + '-preserved');
  assert.equal((await run(process.execPath, ['--input-type=module', '-e', source], { cwd: resolve('dist'), env })).stdout.trim(), join(home, 'Library', 'Application Support', 'Holocron'));
});

test('legacy managed login file keeps its exact bytes and label and refuses duplicate labels', async (t) => {
  const home = await temporary(t); const local = join(home, 'http.json');
  await writeFile(local, JSON.stringify(config), { mode: 0o600 });
  const node = join(home, 'node'); const cli = join(home, 'cli.js');
  await writeFile(node, 'not executed', { mode: 0o700 }); await writeFile(cli, 'not executed', { mode: 0o600 });
  const env = { platform: 'darwin', home, node, cli };
  await loginAction('install', local, env);
  const current = join(home, 'Library', 'LaunchAgents', LOGIN_LABEL + '.plist');
  const old = join(home, 'Library', 'LaunchAgents', 'org.shared-clipboard.companion.plist');
  const bytes = (await readFile(current, 'utf8')).replaceAll('org.holocron.companion', 'org.shared-clipboard.companion')
    .replace('holocron managed login v1', 'shared-clipboard managed login v1');
  await rename(current, old); await writeFile(old, bytes);
  assert.equal((await loginAction('install', local, env)).label, 'org.shared-clipboard.companion');
  assert.equal(await readFile(old, 'utf8'), bytes);
  await writeFile(current, 'conflicting', { mode: 0o600 });
  for (const action of ['install', 'status', 'remove'] as const) await assert.rejects(loginAction(action, local, env), /login_conflict/);
  assert.equal(await readFile(old, 'utf8'), bytes);
});
