import assert from 'node:assert/strict';
import { once } from 'node:events';
import { connect } from 'node:net';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { makeVerifier } from '../src/auth.ts';
import type { AuthVerifier } from '../src/auth.ts';
import { createProbeHttp, BODY_LIMIT, MAX_CONCURRENT } from '../src/http.ts';
import { PROBE_TEXT, PROBE_DIGEST } from '../src/mcp.ts';
import { config, localKeys, token } from './fixtures.ts';

const verify = makeVerifier(config, localKeys);
async function fixture(t: TestContext, verifier: AuthVerifier = verify, deadlineMs?: number) {
  const server = createProbeHttp(config, verifier, deadlineMs === undefined ? {} : { deadlineMs });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { server, base, port: address.port };
}

const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
  protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'synthetic-client', version: '0.0.0' },
} };
function request(base: string, bearer?: string, body: unknown = initialize, headers: Record<string, string> = {}, path = '/mcp') {
  return fetch(base + path, {
    method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...headers },
  });
}
async function rawRequest(port: number, raw: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    const parts: Buffer[] = [];
    socket.on('connect', () => socket.write(raw));
    socket.on('data', (part: Buffer) => parts.push(part));
    socket.on('error', reject);
    socket.on('close', () => resolve(Buffer.concat(parts).toString()));
    socket.setTimeout(2000, () => { socket.destroy(); reject(new Error('Raw request timeout')); });
  });
}

test('official MCP client discovers schemas, metadata and calls both synthetic tools', async (t) => {
  const { base } = await fixture(t);
  const client = new Client({ name: 'synthetic-test', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
    requestInit: { headers: { Authorization: `Bearer ${await token()}` } },
  });
  t.after(() => client.close());
  await client.connect(transport);
  const { tools } = await client.listTools();
  const wire = await request(base, await token(), { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} });
  const wireTools = (await wire.json()).result.tools;
  for (const tool of wireTools) assert.deepEqual(tool.securitySchemes, tool._meta.securitySchemes);
  assert.deepEqual(tools.map((tool) => tool.name), ['get_bridge_status', 'read_synthetic_probe']);
  for (const tool of tools) {
    assert.ok(tool._meta?.securitySchemes);
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tool.annotations?.openWorldHint, false);
    assert.equal(tool.annotations?.destructiveHint, false);
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.ok(tool.outputSchema);
  }
  const status = await client.callTool({ name: 'get_bridge_status', arguments: {} });
  assert.equal(status.isError, undefined);
  const structured = status.structuredContent as { authorization: { ownerMatched: boolean; principalId: string }; tunnel: string };
  assert.equal(structured.authorization.ownerMatched, true);
  assert.match(structured.authorization.principalId, /^[a-f0-9]{64}$/);
  assert.equal(structured.tunnel, 'unverified');
  const read = await client.callTool({ name: 'read_synthetic_probe', arguments: { id: 'phase1-marker' } });
  assert.deepEqual(read.structuredContent, { id: 'phase1-marker', text: PROBE_TEXT, sha256: PROBE_DIGEST, byteCount: Buffer.byteLength(PROBE_TEXT) });
  const output = JSON.stringify([status, read, tools]);
  assert.equal(output.includes(config.ownerSubject), false);
  assert.equal(output.includes(config.issuer), false);
  assert.equal(output.includes('Authorization: Bearer'), false);
  assert.equal(transport.sessionId, undefined);
});

test('transport auth is checked on every message; discovery is public but does not authorize', async (t) => {
  const { base } = await fixture(t);
  for (const route of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200);
    const metadata = await response.json();
    assert.equal(metadata.resource, config.resource);
    assert.deepEqual(metadata.authorization_servers, [config.issuer]);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  const success = await request(base, await token());
  assert.equal(success.status, 200);
  assert.equal(success.headers.get('mcp-session-id'), null);
  for (const [bearer, expected] of [[undefined, 401], ['secret-sentinel', 401], [await token({ sub: 'another-owner' }), 403],
    [await token({ scope: 'probe:read' }), 403], [await token({ exp: 1 }), 401]] as const) {
    const response = await request(base, bearer);
    assert.equal(response.status, expected);
    assert.match(response.headers.get('www-authenticate')!, /resource_metadata="https:\/\/synthetic-resource.invalid\/.well-known\/oauth-protected-resource\/mcp"/);
    assert.equal((await response.text()).includes('secret-sentinel'), false);
  }
  const forged = await request(base, undefined, { ...initialize, _meta: { authInfo: { scopes: ['probe:read'], ownerMatched: true } } });
  assert.equal(forged.status, 401);
  assert.equal((await fetch(base + '/mcp?access_token=secret-sentinel')).status, 404);
});

test('tool scopes cannot be upgraded by JSON-RPC metadata; strict input schemas reject arbitrary inputs', async (t) => {
  const { base } = await fixture(t);
  const call = (name: string, args: unknown, meta?: unknown) => ({ jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name, arguments: args, ...(meta ? { _meta: meta } : {}) } });
  const denied = await request(base, await token({ scope: 'probe:status' }), call('read_synthetic_probe', { id: 'phase1-marker' }, {
    authInfo: { scopes: ['probe:status', 'probe:read'], ownerMatched: true },
  }));
  const response = await denied.json();
  assert.equal(response.result.isError, true);
  assert.ok(response.result._meta['mcp/www_authenticate'][0].includes('probe:read'));
  assert.equal(response.result.structuredContent, undefined);
  for (const body of [call('get_bridge_status', { path: '/private/forbidden' }),
    call('read_synthetic_probe', { id: '../private' }), call('read_synthetic_probe', { id: 'phase1-marker', url: 'https://attacker.invalid' }),
    call('arbitrary_shell', { command: 'secret-sentinel' })]) {
    const rejected = await request(base, await token(), body);
    const data = await rejected.json();
    assert.ok(data.error || data.result?.isError);
    assert.equal(JSON.stringify(data).includes(PROBE_TEXT), false);
  }
});

test('enforce host, origin, route, method, content type, session and protocol boundaries', async (t) => {
  const { base, port } = await fixture(t);
  const bearer = await token();
  for (const [headers, expected] of [
    [{ Origin: 'https://attacker.invalid' }, 403], [{ Origin: 'null' }, 403],
    [{ 'Content-Type': 'text/plain' }, 415], [{ 'Content-Encoding': 'gzip' }, 415],
    [{ 'Mcp-Session-Id': 'reused-authority' }, 400], [{ 'Mcp-Protocol-Version': 'not-a-version' }, 400],
    [{ Accept: 'text/plain' }, 406],
  ] as const) assert.equal((await request(base, bearer, initialize, headers)).status, expected, JSON.stringify(headers));
  for (const method of ['GET', 'DELETE', 'PUT', 'PATCH', 'HEAD']) {
    assert.equal((await fetch(base + '/mcp', { method })).status, 405);
  }
  assert.equal((await request(base, bearer, initialize, {}, '/mcp/')).status, 404);
  assert.equal((await request(base, bearer, initialize, {}, '/.well-known/oauth-protected-resource/mcp')).status, 405);
  assert.equal((await fetch(base + '/.well-known/oauth-authorization-server')).status, 404);
  const duplicate = await rawRequest(port, `POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nAuthorization: Bearer secret-sentinel\r\nAuthorization: Bearer other\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
  assert.match(duplicate, /HTTP\/1.1 403/);
  const badHost = await rawRequest(port, 'GET /.well-known/oauth-protected-resource HTTP/1.1\r\nHost: attacker.invalid\r\nConnection: close\r\n\r\n');
  assert.match(badHost, /HTTP\/1.1 403/);
  const allowed = await request(base, bearer, initialize, { Origin: 'https://synthetic-client.invalid', 'X-Forwarded-Host': 'attacker.invalid' });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://synthetic-client.invalid');
});

test('CORS preflight requires an exact configured origin and bounded header/method set', async (t) => {
  const { base } = await fixture(t);
  const headers = { Origin: 'https://synthetic-client.invalid', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' };
  assert.equal((await fetch(base + '/mcp', { method: 'OPTIONS', headers })).status, 204);
  for (const patch of [{ Origin: 'https://attacker.invalid' }, { 'Access-Control-Request-Method': 'DELETE' }, { 'Access-Control-Request-Headers': 'cookie' }]) {
    assert.equal((await fetch(base + '/mcp', { method: 'OPTIONS', headers: { ...headers, ...patch } })).status, 403);
  }
  assert.equal((await fetch(base + '/mcp', { method: 'OPTIONS' })).status, 403);
});

test('reject declared and chunked oversized bodies, invalid JSON, batches and invalid UTF-8', async (t) => {
  const { base, port } = await fixture(t);
  const bearer = await token();
  // Send an oversized declared length without uploading the body. The server
  // rejects headers immediately; fetch can race that close with its large write
  // and report EPIPE instead of exposing the already-sent 413 response.
  const declared = await rawRequest(port, `POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nAuthorization: Bearer ${bearer}\r\nContent-Type: application/json\r\nContent-Length: ${BODY_LIMIT + 1}\r\nConnection: close\r\n\r\n`);
  assert.match(declared, /HTTP\/1.1 413/);
  for (const body of ['{', '[]', 'null', JSON.stringify([initialize, initialize])]) {
    assert.equal((await request(base, bearer, body)).status, 400);
  }
  const large = 'a'.repeat(BODY_LIMIT + 1);
  const chunked = await rawRequest(port, `POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nAuthorization: Bearer ${bearer}\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n${large.length.toString(16)}\r\n${large}\r\n0\r\n\r\n`);
  assert.match(chunked, /HTTP\/1.1 413/);
  const utf8 = await fetch(base + '/mcp', { method: 'POST', headers: {
    Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
  }, body: new Uint8Array([123, 34, 97, 34, 58, 34, 255, 34, 125]) });
  assert.equal(utf8.status, 400);
});

test('deadline bounds slow auth and body; late failures do not produce unhandled errors', async (t) => {
  const slow: AuthVerifier = async () => { await new Promise((resolve) => setTimeout(resolve, 120)); throw new Error('secret-sentinel'); };
  const { base } = await fixture(t, slow, 60);
  const response = await request(base, await token());
  assert.equal(response.status, 408);
  assert.equal((await response.text()).includes('secret-sentinel'), false);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const normal = await fixture(t, verify, 60);
  const raw = await rawRequest(normal.port, `POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:${normal.port}\r\nAuthorization: Bearer ${await token()}\r\nContent-Type: application/json\r\nContent-Length: 100\r\nConnection: close\r\n\r\n{`);
  assert.match(raw, /HTTP\/1.1 408/);
});

test('bounded concurrent authorization work rejects overflow and releases slots', { timeout: 5000 }, async (t) => {
  const pending: (() => void)[] = [];
  const gated: AuthVerifier = async (header) => {
    await new Promise<void>((resolve) => pending.push(resolve));
    return verify(header);
  };
  const { base } = await fixture(t, gated);
  const bearer = await token();
  const accepted = Array.from({ length: MAX_CONCURRENT }, () => request(base, bearer));
  // Wait only for these local requests to reach the injected verifier.
  while (pending.length < MAX_CONCURRENT) await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await request(base, bearer)).status, 503);
  pending.splice(0).forEach((resolve) => resolve());
  for (const response of await Promise.all(accepted)) assert.equal(response.status, 200);
  const next = request(base, bearer);
  while (!pending.length) await new Promise((resolve) => setImmediate(resolve));
  pending.splice(0).forEach((resolve) => resolve());
  assert.equal((await next).status, 200);
});
