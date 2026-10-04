import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, stat, writeFile, unlink, symlink, rm, realpath } from 'node:fs/promises';
import { once } from 'node:events';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';

const temporary = await mkdtemp(join(await realpath('/tmp'), 'sc-package-'));
const version = JSON.parse(await readFile('package.json', 'utf8')).version;

try {
  const home = join(temporary, 'home'); await mkdir(home, { mode: 0o700 });
  const environment = { PATH: process.env.PATH, HOME: home, npm_config_cache: join(temporary, 'npm-cache'),
    npm_config_userconfig: join(temporary, 'npmrc'), npm_config_audit: 'false', npm_config_fund: 'false' };
  await writeFile(environment.npm_config_userconfig, '', { mode: 0o600 });
  await mkdir(join(home, '.gg', 'codex'), { recursive: true, mode: 0o700 });
  const existingSettings = join(home, '.gg', 'codex', 'config.toml');
  await writeFile(existingSettings, 'unrelated-setting = true\n', { mode: 0o600 });
  const filename = 'holocron-package.tgz';
  // Canonical check already built dist. Avoid a second lifecycle build during packaging.
  execFileSync('bun', ['pm', 'pack', '--filename', join(temporary, filename), '--ignore-scripts'], { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 30000 });
  const paths = execFileSync('tar', ['-tzf', join(temporary, filename)], { encoding: 'utf8' }).trim().split('\n')
    .filter(path => !path.endsWith('/')).map(path => path.replace(/^package\//, ''));
  const packed = { filename };
  assert.ok(paths.includes('dist/cli.js'));
  assert.ok(paths.includes('dist/file-snapshot.js'));
  assert.ok(paths.includes('dist/cloud-cli.js'));
  assert.ok(paths.includes('docs/cloud-clipboard.md'));
  assert.ok(paths.includes('docs/context-files.md'));
  assert.ok(paths.includes('docs/operations.md'));
  assert.ok(paths.includes('native/HolocronSecrets.swift'));
  assert.ok(paths.includes('docs/secret-requests.md'));
  assert.ok(paths.includes('plugins/holocron/plugin.json'));
  assert.ok(paths.includes('plugins/holocron/.app.json'));
  const allowed = new Set(['README.md', 'package.json', 'native/HolocronSecrets.swift', 'plugins/holocron/plugin.json', 'plugins/holocron/.app.json',
    ...['phase1-setup', 'text-bridge', 'context-files', 'cloud-clipboard', 'operations', 'secure-mcp-tunnel',
      'overview', 'getting-started', 'reference', 'troubleshooting', 'secret-requests', 'secret-operations', 'raycast'].map((name) => `docs/${name}.md`),
    ...(await readdir('src')).filter((name) => name.endsWith('.ts')).map((name) => 'dist/' + name.replace(/\.ts$/, '.js'))]);
  assert.deepEqual(new Set(paths), allowed);
  for (const path of paths) {
    assert.doesNotMatch(path, /(?:\.env|\.tgz|\.map$|node_modules|probe-config|\.sqlite|\.sock|\.plist)/);
    const bytes = await readFile(path);
    assert.doesNotMatch(bytes.toString('utf8'), /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|sk-(?:proj|svcacct)-|\/Users\/|plugin_asdk_app_[A-Za-z0-9]+|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/);
  }
  const clean = join(temporary, 'clean');
  await mkdir(clean);
  await writeFile(join(clean, 'package.json'), JSON.stringify({ name: 'clean-smoke-profile', private: true, type: 'module' }));
  execFileSync('bun', ['install', '--production', '--ignore-scripts', join(temporary, packed.filename)], {
    cwd: clean, env: environment, encoding: 'utf8', maxBuffer: 1024 * 1024,
  });
  const installed = join(clean, 'node_modules/@amxv/holocron');
  for (const path of paths) assert.deepEqual(await readFile(join(installed, path)), await readFile(path));
  for (const developmentOnly of ['typescript', '@types/node']) await assert.rejects(stat(join(clean, 'node_modules', developmentOnly)));
  const cli = join(installed, 'dist/cli.js');
  const holocron = join(installed, 'dist/holocron.js');
  const cliRun = (args, input) => execFileSync(process.execPath, [cli, ...args], { env: environment, encoding: 'utf8', ...(input !== undefined ? { input } : {}) });
  assert.match(execFileSync(join(clean, 'node_modules/.bin/shared-clipboard-cloud'), ['--help'], { encoding: 'utf8' }), /foreground owner|foreground ownership/);
  assert.match(cliRun(['--help']), /capture explicitly reads the Mac clipboard/);
  assert.match(execFileSync(join(clean, 'node_modules/.bin/shared-clipboard'), ['--help'], { encoding: 'utf8' }), /share-text/);
  assert.equal(execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim(), version);
  for (const name of ['holocron', 'holocron-cloud', 'board', 'shared-clipboard', 'shared-clipboard-probe', 'shared-clipboard-cloud']) {
    const bin = join(clean, 'node_modules/.bin', name);
    assert.match(execFileSync(bin, ['--help'], { env: environment, encoding: 'utf8' }), /Usage:/);
    assert.equal(execFileSync(bin, ['--version'], { env: environment, encoding: 'utf8' }).trim(), version);
  }
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
  assert.equal(JSON.parse(await readFile(join(pluginOutput, '.app.json'), 'utf8')).apps['holocron'].id, 'plugin_asdk_app_SYNTHETICTESTONLY');

  const text = '\ufeffSnow 雪 🚀 "quotes" \'single\' `backticks` $(never-execute) $HOME\nnew line\n';
  const command = (name, ...extra) => [name, ...extra, '--config', configPath];
  const snapshot = JSON.parse(cliRun(command('share-text'), text));
  assert.equal(snapshot.sha256, createHash('sha256').update(text).digest('hex'));
  assert.equal(JSON.parse(cliRun(command('list'))).items[0].id, snapshot.id);
  const fileBytes = Buffer.from('\ufeff' + 'a'.repeat(65531) + '🚀雪é\r\n' + text.repeat(4000));
  const selected = join(temporary, 'PRIVATE_CONTEXT_SOURCE');
  const selectedLink = join(temporary, 'selected-link');
  await writeFile(selected, fileBytes); await symlink(selected, selectedLink);
  const fileSnapshot = JSON.parse(cliRun(command('share-file', selectedLink, '--name', 'Packaged context')));
  assert.equal(fileSnapshot.kind, 'file');
  assert.equal(fileSnapshot.byteCount, fileBytes.length);
  assert.equal(fileSnapshot.sha256, createHash('sha256').update(fileBytes).digest('hex'));
  assert.equal(JSON.stringify(fileSnapshot).includes(selected), false);
  await writeFile(selected, 'modified'); await unlink(selected);
  await writeFile(selected, Buffer.from([0xff]));
  assert.throws(() => cliRun(command('share-file', selected)), /invalid_utf8/);
  assert.throws(() => cliRun(command('share-file', temporary)), /unsupported_file/);
  await unlink(selected);
  assert.equal(JSON.parse(cliRun(command('status'))).localTransport, 'stopped');
  // A clean installed foreground service, controlled locally, performs no actual clipboard operation.
  for (let restart = 0; restart < 2; restart++) {
  const child = spawn(process.execPath, [cli, ...command('start')], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
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
  }

  const load = (path) => import(pathToFileURL(join(installed, path)).href);
  // The installed production CLI is launched by the official SDK, without
  // provider config, listeners, credentials or real clipboard operations.
  const { Client } = await load('node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js').catch(() =>
    import(pathToFileURL(join(clean, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js')).href));
  const { StdioClientTransport } = await load('node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js').catch(() =>
    import(pathToFileURL(join(clean, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js')).href));
  const localConfigPath = join(temporary, 'local.json');
  await writeFile(localConfigPath, JSON.stringify({ transport: 'stdio', stateDirectory: join(temporary, 'stdio-state') }), { mode: 0o600 });
  const localArgs = (name, ...extra) => [name, ...extra, '--local-config', localConfigPath];
  const holocronRun = (args, input) => execFileSync(process.execPath, [holocron, ...args], {
    cwd: '/', env: environment, encoding: 'utf8', ...(input !== undefined ? { input } : {}),
  });
  const localItem = JSON.parse(holocronRun(localArgs('share'), text));
  const localSelected = join(temporary, 'stdio-selected-context');
  await writeFile(localSelected, text);
  const localDigest = createHash('sha256').update(text).digest('hex');
  const localFile = JSON.parse(holocronRun(localArgs('share-file', localSelected)));
  const writeLog = join(temporary, 'stdio-write-events');
  const fixture = join(temporary, 'stdio-injected-adapter.mjs');
  await writeFile(fixture, `import { appendFile } from 'node:fs/promises';
import { runCli } from ${JSON.stringify(pathToFileURL(join(installed, 'dist/cli-main.js')).href)};
process.exitCode = await runCli(process.argv.slice(2), { stdin: process.stdin, out: (line) => console.log(line), error: (line) => console.error(line) }, {
  availability: 'test-adapter', read: async () => { throw Error('No implicit read'); },
  write: async (bytes) => { await appendFile(${JSON.stringify(writeLog)}, Buffer.from(bytes).toString('base64') + '\\n'); }
});\n`, { mode: 0o600 });
  let localReceipt;
  const localRequest = { request_id: 'installed_stdio_receipt_01', text, expected_sha256: localDigest,
    valid_until: new Date(Date.now() + 60000).toISOString() };
  for (const entry of [cli, holocron, fixture, fixture]) {
    const transport = new StdioClientTransport({ command: process.execPath,
      args: [entry, ...localArgs('stdio')], env: environment, stderr: 'pipe' });
    let errors = ''; transport.stderr.on('data', (bytes) => { errors += bytes.toString(); });
    const client = new Client({ name: 'clean-installed-stdio-test', version: '1' });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      assert.equal(tools.tools.length, 5);
      for (const tool of tools.tools) assert.deepEqual(tool._meta.securitySchemes, [{ type: 'noauth' }]);
      const call = (name, args = {}) => client.callTool({ name, arguments: args });
      const status = (await call('get_bridge_status')).structuredContent;
      assert.equal(status.transport, 'stdio'); assert.equal(status.oauthProvider, 'not-required');
      assert.equal(status.trustBoundary, 'same-user-private-tunnel');
      assert.equal((await call('read_shared_item', { id: localItem.id })).structuredContent.text, text);
      assert.equal((await call('read_shared_item', { id: localFile.id })).structuredContent.sha256, localDigest);
      assert.equal((await call('read_shared_item', { id: localSelected })).isError, true);
      if (entry === fixture) {
        assert.equal((await call('copy_text_to_mac', { ...localRequest, text: 'altered' })).isError, true);
        const receipt = (await call('copy_text_to_mac', localRequest)).structuredContent;
        assert.equal(receipt.state, 'completed');
        if (localReceipt) assert.deepEqual(receipt, localReceipt); else localReceipt = receipt;
      }
    } finally { await client.close(); }
    assert.equal(errors, '');
    assert.equal(JSON.parse(cliRun(localArgs('status'))).localTransport, 'stopped');
  }
  assert.equal(await readFile(writeLog, 'utf8'), Buffer.from(text).toString('base64') + '\n');
  assert.equal(JSON.parse(cliRun(localArgs('revoke', localFile.id))).revoked, true);
  assert.equal(JSON.parse(cliRun(localArgs('clear'))).cleared, 1);

  const { runCli } = await load('dist/cli-main.js');
  const loginEnvironment = { platform: 'darwin', home, node: await realpath(process.execPath), cli };
  const loginLines = [];
  const loginIO = { stdin: (async function* () { throw Error('No login stdin'); })(),
    out: (line) => loginLines.push(JSON.parse(line)), error: (line) => assert.fail(line) };
  const noClipboard = { availability: 'test-adapter', read: async () => assert.fail('No login capture'), write: async () => assert.fail('No login write') };
  const login = (action) => runCli(command('login-' + action), loginIO, noClipboard, loginEnvironment);
  assert.equal(await login('status'), 0); assert.equal(loginLines.at(-1).nextLogin, 'disabled');
  assert.equal(await login('install'), 0); assert.equal(loginLines.at(-1).launchd, 'unverified');
  const job = join(home, 'Library', 'LaunchAgents', 'org.holocron.companion.plist');
  assert.equal((await stat(job)).mode & 0o777, 0o600);
  const jobText = await readFile(job, 'utf8'); assert.ok(jobText.includes(cli));
  assert.equal(await login('install'), 0); assert.equal(await readFile(job, 'utf8'), jobText);
  assert.equal(await login('status'), 0); assert.equal(loginLines.at(-1).nextLogin, 'enabled');
  assert.equal(await login('remove'), 0); assert.equal(await login('remove'), 0); await assert.rejects(stat(job));
  assert.equal(await readFile(existingSettings, 'utf8'), 'unrelated-setting = true\n');
  // Exercise the independent installed helper CLI boundary with a controlled
  // backend, never a real graphical clipboard. There is no production command override.
  const { runCloudCli } = await load('dist/cloud-cli-main.js');
  const { CloudClipboard } = await load('dist/cloud-clipboard.js');
  const cloudCalls = [];
  let cloudValue = Buffer.from(text);
  let releaseOwner;
  const cloud = new CloudClipboard({ platform: 'linux',
    env: { WAYLAND_DISPLAY: 'test-session', XDG_RUNTIME_DIR: '/synthetic-session', CONTROL_PLANE_API_KEY: 'NEVER_FORWARD' },
    executable: async () => true, socket: async () => true }, (command, input, signal) => {
    cloudCalls.push(command);
    assert.deepEqual(Object.keys(command.env).sort(), ['LANG', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR']);
    if (input === undefined) return { fed: Promise.resolve(), done: Promise.resolve({ code: 0, signal: null, output: cloudValue }), running: () => false, stop() {} };
    cloudValue = Buffer.from(input);
    let active = true;
    const done = new Promise((resolve) => { releaseOwner = () => { active = false; resolve({ code: 0, signal: null, output: Buffer.alloc(0) }); }; });
    return { fed: Promise.resolve(), done, running: () => active, stop() { if (active) releaseOwner(); } };
  });
  const cloudLines = [];
  const cloudIO = (bytes) => ({ stdin: (async function* () { yield bytes; })(),
    out(line) { cloudLines.push(JSON.parse(line)); if (cloudLines.at(-1).state === 'owned') releaseOwner(); },
    error(line) { throw new Error(line); } });
  assert.equal(await runCloudCli(['probe'], cloudIO(Buffer.alloc(0)), cloud), 0);
  assert.equal(cloudLines.at(-1).viewedDesktop, 'unverified'); assert.equal(cloudCalls.length, 0);
  const cloudDigest = createHash('sha256').update(text).digest('hex');
  const cloudData = join(temporary, '`literal` $HOME $(never).txt');
  await writeFile(cloudData, Buffer.from(text));
  for (const args of [['write', '--sha256', cloudDigest], ['write', '--sha256', cloudDigest, '--file', cloudData]]) {
    assert.equal(await runCloudCli(args, cloudIO(Buffer.from(text)), cloud), 0);
    assert.equal(cloudLines.at(-2).state, 'owned'); assert.equal(cloudLines.at(-2).sha256, snapshot.sha256);
    assert.equal(cloudLines.at(-1).state, 'ownership-ended'); assert.deepEqual(cloudValue, Buffer.from(text));
  }
  assert.equal(await runCloudCli(['read'], cloudIO(Buffer.alloc(0)), cloud), 0);
  const cloudCapture = cloudLines.at(-1);
  assert.deepEqual(Buffer.from(cloudCapture.text), Buffer.from(text)); assert.equal(cloudCapture.sha256, cloudDigest);
  const cloudCallCount = cloudCalls.length;
  const cloudErrors = [];
  for (const bytes of [Buffer.from('altered'), Buffer.from([0xff]), Buffer.alloc(256 * 1024 + 1)]) {
    assert.equal(await runCloudCli(['write', '--sha256', cloudDigest], { ...cloudIO(bytes), error: (line) => cloudErrors.push(JSON.parse(line)) }, cloud), 1);
  }
  assert.equal(cloudCalls.length, cloudCallCount); assert.equal(cloudErrors.length, 3);
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
  const input = { request_id: 'package_smoke_request_01', text: cloudCapture.text, expected_sha256: cloudCapture.sha256,
    valid_until: new Date(Date.now() + 60000).toISOString() };
  let receipt;
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
    const listed = [];
    let cursor;
    do {
      const page = (await call('list_shared_items', { limit: 1, ...(cursor ? { cursor } : {}) })).structuredContent;
      listed.push(...page.items); cursor = page.nextCursor;
    } while (cursor);
    assert.deepEqual(new Set(listed.map((item) => item.id)), new Set([snapshot.id, fileSnapshot.id]));
    assert.equal((await call('read_shared_item', { id: snapshot.id })).structuredContent.text, text);
    const fileParts = [];
    let offset = 0;
    while (true) {
      const page = (await call('read_shared_item', { id: fileSnapshot.id, offset })).structuredContent;
      const part = Buffer.from(page.text, 'utf8');
      assert.equal(page.kind, 'file'); assert.ok(part.length <= 65536);
      assert.equal(page.nextOffset, offset + part.length); assert.equal(page.sha256, fileSnapshot.sha256);
      assert.equal(JSON.stringify(page).includes(selected), false);
      fileParts.push(part); offset = page.nextOffset;
      if (page.complete) break;
    }
    const reconstructed = Buffer.concat(fileParts);
    assert.deepEqual(reconstructed, fileBytes);
    assert.equal(createHash('sha256').update(reconstructed).digest('hex'), fileSnapshot.sha256);
    const materialized = join(temporary, 'reconstructed-context'); await writeFile(materialized, reconstructed);
    assert.equal(createHash('sha256').update(await readFile(materialized)).digest('hex'), fileSnapshot.sha256);
    assert.equal((await call('read_shared_item', { id: selected })).isError, true);
    assert.equal((await call('read_shared_item', { id: fileSnapshot.id, offset: 1 })).isError, true);
    assert.equal((await call('copy_text_to_mac', { ...input, text: input.text + 'altered' })).isError, true);
    assert.equal(adapter.writes, 0); assert.equal(store.receipt(input.request_id), undefined);
    receipt = (await call('copy_text_to_mac', input)).structuredContent;
    assert.equal(receipt.state, 'completed'); assert.deepEqual(adapter.value, Buffer.from(text));
    adapter.value = Buffer.from('newer');
    assert.deepEqual((await call('copy_text_to_mac', input)).structuredContent, receipt);
    assert.equal(adapter.writes, 1); assert.equal(adapter.value.toString(), 'newer');
    assert.equal((await call('copy_text_to_mac', { ...input, text: 'conflict' })).isError, true);
    const readJwt = await new SignJWT({ iss: operatorConfig.issuer, sub: operatorConfig.ownerSubject, aud: operatorConfig.resource,
      iat: now, exp: now + 60, scope: 'probe:status probe:read' }).setProtectedHeader({ alg: 'ES256', typ: 'at+jwt' }).sign(keys.privateKey);
    assert.equal((await call('copy_text_to_mac', input, readJwt)).isError, true);
    const statusJwt = await new SignJWT({ iss: operatorConfig.issuer, sub: operatorConfig.ownerSubject, aud: operatorConfig.resource,
      iat: now, exp: now + 60, scope: 'probe:status' }).setProtectedHeader({ alg: 'ES256', typ: 'at+jwt' }).sign(keys.privateKey);
    assert.equal((await call('read_shared_item', { id: fileSnapshot.id }, statusJwt)).isError, true);
    assert.equal(JSON.parse(cliRun(command('revoke', fileSnapshot.id))).revoked, true);
    assert.equal((await call('read_shared_item', { id: fileSnapshot.id, offset: 3 })).isError, true);
    assert.equal(JSON.parse(cliRun(command('revoke', snapshot.id))).revoked, true);
    assert.equal((await call('read_shared_item', { id: snapshot.id })).isError, true);
    cliRun(command('share-text'), 'clear this');
    assert.equal(JSON.parse(cliRun(command('clear'))).cleared, 1);
    assert.deepEqual(JSON.parse(await readFile(join(installed, 'plugins/holocron/.app.json'), 'utf8')), { apps: {} });
  } finally {
    await bridge.stop(); store.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }

  // A new installed store/server and new HTTP calls model a local restart/reconnect.
  // No OAuth account or real tunnel connection is substituted by this synthetic gate.
  let clock = Date.now();
  const restartedStore = await ShareStore.open(operatorConfig.stateDirectory, ownerId(operatorConfig), { now: () => clock });
  const restartedBridge = new ClipboardBridge(restartedStore, adapter, () => clock);
  const restartedServer = createProbeHttp(configSchema.parse(operatorConfig), verifier, { bridge: restartedBridge });
  restartedServer.listen(0, '127.0.0.1'); await once(restartedServer, 'listening');
  try {
    const base = `http://127.0.0.1:${restartedServer.address().port}`;
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss: operatorConfig.issuer, sub: operatorConfig.ownerSubject, aud: operatorConfig.resource,
      iat: now, exp: now + 60, scope: 'probe:status probe:read clipboard:write' };
    const sign = (claims) => new SignJWT(claims).setProtectedHeader({ alg: 'ES256', typ: 'at+jwt' }).sign(keys.privateKey);
    const jwt = await sign(claims);
    const request = (name, args, bearer = jwt) => fetch(base + '/mcp', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } }) });
    const call = async (name, args) => { const response = await request(name, args); assert.equal(response.status, 200); return (await response.json()).result; };
    assert.deepEqual((await call('copy_text_to_mac', input)).structuredContent, receipt);
    assert.equal(adapter.writes, 1); assert.equal(adapter.value.toString(), 'newer');
    const expiredJwt = await sign({ ...claims, iat: now - 120, exp: now - 1 });
    const nonowner = await sign({ ...claims, sub: 'not-the-owner' });
    assert.equal((await request('get_bridge_status', {}, expiredJwt)).status, 401);
    assert.equal((await request('get_bridge_status', {}, nonowner)).status, 403);
    const expires = restartedStore.capture(Buffer.from('synthetic expiry marker'));
    clock += 24 * 60 * 60 * 1000;
    assert.equal((await call('read_shared_item', { id: expires.id })).isError, true);
    assert.equal(restartedStore.counts().sharedItems, 0);
    clock += 8 * 24 * 60 * 60 * 1000; restartedStore.purge();
    assert.equal(restartedStore.receipt(input.request_id), undefined);
    assert.equal((await call('copy_text_to_mac', input)).isError, true); // Expired envelope after cleanup cannot revive.
    assert.equal(adapter.writes, 1); assert.equal(adapter.value.toString(), 'newer');
  } finally {
    await restartedBridge.stop(); restartedStore.close();
    restartedServer.closeAllConnections(); await new Promise((resolve) => restartedServer.close(resolve));
  }
  // Removal uses the isolated prefix only and preserves unrelated profile settings and selected files.
  execFileSync('bun', ['remove', '--ignore-scripts', '@amxv/holocron'],
    { cwd: clean, env: environment, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  await assert.rejects(stat(installed));
  assert.equal(await readFile(existingSettings, 'utf8'), 'unrelated-setting = true\n');
  assert.deepEqual(await readFile(cloudData), Buffer.from(text));
  console.log(`Clean private package install/removal, all three bins/version/help, official SDK installed STDIO subprocess discovery/sharing/literal writes/restart receipts, isolated login generation/status/remove, Mac start/status/stop/restart, synthetic reconnect/auth/expiry/clear, immutable file reconstruction/digest/revoke, independent helper literal read/write/digest/foreground ownership, and cloud-to-Mac receipt/restart/scope checks passed (${paths.length} distribution files). Injected clipboard boundaries only; real Dots/provider/tunnel/login and viewed OS clipboards remain deferred.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
