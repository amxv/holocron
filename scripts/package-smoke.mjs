import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { once } from 'node:events';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';

const temporary = await mkdtemp(join(await realpath('/tmp'), 'sc-package-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
try {
  const packed = JSON.parse(execFileSync(npm, ['pack', '--json', '--silent', '--pack-destination', temporary], {
    encoding: 'utf8', maxBuffer: 1024 * 1024,
  }))[0];
  const paths = packed.files.map((file) => file.path);
  assert.ok(paths.includes('dist/cli.js'));
  assert.ok(paths.includes('plugins/shared-clipboard/plugin.json'));
  assert.ok(paths.includes('plugins/shared-clipboard/.app.json'));
  for (const path of paths) {
    assert.match(path, /^(dist\/|docs\/|plugins\/shared-clipboard\/|README\.md$|package\.json$)/);
    assert.doesNotMatch(path, /(?:\.env|\.tgz|\.map$|node_modules|probe-config)/);
    const bytes = await readFile(path);
    assert.doesNotMatch(bytes.toString('utf8'), /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|sk-(?:proj|svcacct)-|\/Users\/|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/);
  }
  const clean = join(temporary, 'clean');
  await mkdir(clean);
  await writeFile(join(clean, 'package.json'), JSON.stringify({ name: 'clean-smoke-profile', private: true, type: 'module' }));
  execFileSync(npm, ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', join(temporary, packed.filename)], {
    cwd: clean, encoding: 'utf8', maxBuffer: 1024 * 1024,
  });
  const installed = join(clean, 'node_modules/@shared-clipboard/dots-probe');
  const cli = join(installed, 'dist/cli.js');
  const cliRun = (args, input) => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', ...(input !== undefined ? { input } : {}) });
  assert.match(cliRun(['--help']), /capture explicitly reads the Mac clipboard/);
  assert.match(execFileSync(join(clean, 'node_modules/.bin/shared-clipboard'), ['--help'], { encoding: 'utf8' }), /share-text/);
  assert.equal(execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim(), '0.1.0');
  const operatorConfig = {
    issuer: 'https://synthetic-issuer.invalid', jwksUrl: 'https://synthetic-issuer.invalid/jwks',
    resource: 'https://synthetic-resource.invalid/mcp', ownerSubject: 'synthetic-owner', tokenType: 'at+jwt',
    algorithm: 'ES256', statusScope: 'probe:status', readScope: 'probe:read', writeScope: 'clipboard:write',
    stateDirectory: join(temporary, 'state'),
  };
  const portProbe = createServer(); portProbe.listen(0, '127.0.0.1'); await once(portProbe, 'listening');
  operatorConfig.port = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));
  const configPath = join(temporary, 'synthetic-config.json');
  await writeFile(configPath, JSON.stringify(operatorConfig), { mode: 0o600 });
  assert.match(execFileSync(process.execPath, [cli, 'check-config', '--config', configPath], { encoding: 'utf8' }), /remain unverified/);
  const pluginOutput = join(temporary, 'mapped-plugin');
  execFileSync(process.execPath, [cli, 'prepare-plugin', '--connection-id', 'plugin_asdk_app_SYNTHETICTESTONLY', '--output', pluginOutput]);
  assert.equal(JSON.parse(await readFile(join(pluginOutput, '.app.json'), 'utf8')).apps['shared-clipboard-probe'].id, 'plugin_asdk_app_SYNTHETICTESTONLY');

  const text = '\ufeffSnow 雪 🚀 "quotes" \'single\' `backticks` $(never-execute) $HOME\nnew line\n';
  const command = (name, ...extra) => [name, ...extra, '--config', configPath];
  const snapshot = JSON.parse(cliRun(command('share-text'), text));
  assert.equal(snapshot.sha256, createHash('sha256').update(text).digest('hex'));
  assert.equal(JSON.parse(cliRun(command('list'))).items[0].id, snapshot.id);
  assert.equal(JSON.parse(cliRun(command('status'))).localTransport, 'stopped');
  // A clean installed foreground service, controlled locally, performs no actual clipboard operation.
  const child = spawn(process.execPath, [cli, ...command('start')], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', (data) => { if (data.toString().includes('listening on IPv4 loopback')) resolve(); });
    child.once('exit', () => reject(new Error('Installed companion exited before ready')));
    child.once('error', reject);
  });
  const deadline = setTimeout(() => child.kill('SIGKILL'), 10000);
  try {
    await ready;
    assert.equal(JSON.parse(cliRun(command('status'))).localTransport, 'available');
    assert.equal(JSON.parse(cliRun(command('stop'))).localTransport, 'stopped');
    assert.equal((await exited)[0], 0);
  } finally { clearTimeout(deadline); if (child.exitCode === null) child.kill('SIGKILL'); }

  const load = (path) => import(pathToFileURL(join(installed, path)).href);
  const { configSchema } = await load('dist/config.js');
  const { makeVerifier, ownerId } = await load('dist/auth.js');
  const { createProbeHttp } = await load('dist/http.js');
  const { PROBE_TEXT } = await load('dist/mcp.js');
  const { ShareStore } = await load('dist/store.js');
  const { ClipboardBridge } = await load('dist/bridge.js');
  const { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } = await load('node_modules/jose/dist/webapi/index.js').catch(() =>
    import(pathToFileURL(join(clean, 'node_modules/jose/dist/webapi/index.js')).href));
  const keys = await generateKeyPair('ES256');
  const verifier = makeVerifier(configSchema.parse(operatorConfig), createLocalJWKSet({ keys: [await exportJWK(keys.publicKey)] }));
  const store = await ShareStore.open(operatorConfig.stateDirectory, ownerId(operatorConfig));
  const adapter = { availability: 'test-adapter', writes: 0, value: Buffer.alloc(0),
    read: async () => { throw new Error('No clipboard capture in package checks'); },
    async write(bytes) { this.value = Buffer.from(bytes); this.writes++; } };
  const bridge = new ClipboardBridge(store, adapter);
  const server = createProbeHttp(configSchema.parse(operatorConfig), verifier, { bridge });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const now = Math.floor(Date.now() / 1000);
    const jwt = await new SignJWT({ iss: operatorConfig.issuer, sub: operatorConfig.ownerSubject, aud: operatorConfig.resource,
      iat: now, exp: now + 60, scope: 'probe:status probe:read clipboard:write' }).setProtectedHeader({ alg: 'ES256', typ: 'at+jwt' }).sign(keys.privateKey);
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
      name: 'read_synthetic_probe', arguments: { id: 'phase1-marker' },
    } });
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    assert.equal((await fetch(base + '/mcp', { method: 'POST', headers, body })).status, 401);
    const response = await fetch(base + '/mcp', { method: 'POST', headers: { ...headers, Authorization: `Bearer ${jwt}` }, body });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).result.structuredContent.text, PROBE_TEXT);
    const call = async (name, args, bearer = jwt) => {
      const response = await fetch(base + '/mcp', { method: 'POST', headers: { ...headers, Authorization: `Bearer ${bearer}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }) });
      assert.equal(response.status, 200); return (await response.json()).result;
    };
    assert.equal((await call('get_bridge_status', {})).structuredContent.liveMacClipboard, 'unverified');
    assert.equal((await call('list_shared_items', { limit: 1 })).structuredContent.items[0].id, snapshot.id);
    assert.equal((await call('read_shared_item', { id: snapshot.id })).structuredContent.text, text);
    const input = { request_id: 'package_smoke_request_01', text, valid_until: new Date(Date.now() + 60000).toISOString() };
    const receipt = (await call('copy_text_to_mac', input)).structuredContent;
    assert.equal(receipt.state, 'completed'); assert.deepEqual(adapter.value, Buffer.from(text));
    adapter.value = Buffer.from('newer');
    assert.deepEqual((await call('copy_text_to_mac', input)).structuredContent, receipt);
    assert.equal(adapter.writes, 1); assert.equal(adapter.value.toString(), 'newer');
    assert.equal((await call('copy_text_to_mac', { ...input, text: 'conflict' })).isError, true);
    const readJwt = await new SignJWT({ iss: operatorConfig.issuer, sub: operatorConfig.ownerSubject, aud: operatorConfig.resource,
      iat: now, exp: now + 60, scope: 'probe:status probe:read' }).setProtectedHeader({ alg: 'ES256', typ: 'at+jwt' }).sign(keys.privateKey);
    assert.equal((await call('copy_text_to_mac', input, readJwt)).isError, true);
    assert.equal(JSON.parse(cliRun(command('revoke', snapshot.id))).revoked, true);
    assert.equal((await call('read_shared_item', { id: snapshot.id })).isError, true);
    cliRun(command('share-text'), 'clear this');
    assert.equal(JSON.parse(cliRun(command('clear'))).cleared, 1);
    assert.deepEqual(JSON.parse(await readFile(join(installed, 'plugins/shared-clipboard/.app.json'), 'utf8')), { apps: {} });
  } finally {
    await bridge.stop(); store.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  console.log(`Clean package install, CLI lifecycle/text sharing, installed-module authenticated text/read/write/retry/scope smoke passed (${paths.length} distribution files). Injected clipboard adapter only; real Dots, provider, tunnel and OS clipboards remain deferred.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
