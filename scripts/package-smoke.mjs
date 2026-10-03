import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const temporary = await mkdtemp(join(tmpdir(), 'clipboard-package-smoke-'));
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
  assert.match(execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8' }), /Synthetic probe only/);
  assert.equal(execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim(), '0.1.0');
  const operatorConfig = {
    issuer: 'https://synthetic-issuer.invalid', jwksUrl: 'https://synthetic-issuer.invalid/jwks',
    resource: 'https://synthetic-resource.invalid/mcp', ownerSubject: 'synthetic-owner', tokenType: 'at+jwt',
    algorithm: 'ES256', statusScope: 'probe:status', readScope: 'probe:read',
  };
  const configPath = join(temporary, 'synthetic-config.json');
  await writeFile(configPath, JSON.stringify(operatorConfig), { mode: 0o600 });
  assert.match(execFileSync(process.execPath, [cli, 'check-config', '--config', configPath], { encoding: 'utf8' }), /remain unverified/);
  const pluginOutput = join(temporary, 'mapped-plugin');
  execFileSync(process.execPath, [cli, 'prepare-plugin', '--connection-id', 'plugin_asdk_app_SYNTHETICTESTONLY', '--output', pluginOutput]);
  assert.equal(JSON.parse(await readFile(join(pluginOutput, '.app.json'), 'utf8')).apps['shared-clipboard-probe'].id, 'plugin_asdk_app_SYNTHETICTESTONLY');

  const load = (path) => import(pathToFileURL(join(installed, path)).href);
  const { configSchema } = await load('dist/config.js');
  const { makeVerifier } = await load('dist/auth.js');
  const { createProbeHttp } = await load('dist/http.js');
  const { PROBE_TEXT } = await load('dist/mcp.js');
  const { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } = await load('node_modules/jose/dist/webapi/index.js').catch(() =>
    import(pathToFileURL(join(clean, 'node_modules/jose/dist/webapi/index.js')).href));
  const keys = await generateKeyPair('ES256');
  const verifier = makeVerifier(configSchema.parse(operatorConfig), createLocalJWKSet({ keys: [await exportJWK(keys.publicKey)] }));
  const server = createProbeHttp(configSchema.parse(operatorConfig), verifier);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const now = Math.floor(Date.now() / 1000);
    const jwt = await new SignJWT({ iss: operatorConfig.issuer, sub: operatorConfig.ownerSubject, aud: operatorConfig.resource,
      iat: now, exp: now + 60, scope: 'probe:status probe:read' }).setProtectedHeader({ alg: 'ES256', typ: 'at+jwt' }).sign(keys.privateKey);
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
      name: 'read_synthetic_probe', arguments: { id: 'phase1-marker' },
    } });
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    assert.equal((await fetch(base + '/mcp', { method: 'POST', headers, body })).status, 401);
    const response = await fetch(base + '/mcp', { method: 'POST', headers: { ...headers, Authorization: `Bearer ${jwt}` }, body });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).result.structuredContent.text, PROBE_TEXT);
    assert.deepEqual(JSON.parse(await readFile(join(installed, 'plugins/shared-clipboard/.app.json'), 'utf8')), { apps: {} });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  console.log(`Clean package install and synthetic authenticated/unauthorized smoke passed (${paths.length} distribution files). No live Dots or cloud clipboard evidence.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
