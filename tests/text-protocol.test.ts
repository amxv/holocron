import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { makeVerifier } from '../src/auth.ts';
import { createProbeHttp } from '../src/http.ts';
import { ClipboardFailure } from '../src/clipboard.ts';
import { readSelectedFile } from '../src/file-snapshot.ts';
import { READ_LIMIT, TEXT_LIMIT } from '../src/text.ts';
import { bridgeFixture, literal } from './bridge-fixtures.ts';
import { config, localKeys, token } from './fixtures.ts';

async function fixture(t: TestContext, deadlineMs?: number) {
  const flow = await bridgeFixture(t);
  const server = createProbeHttp(config, makeVerifier(config, localKeys), { bridge: flow.bridge, ...(deadlineMs ? { deadlineMs } : {}) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  t.after(async () => { await flow.bridge.stop(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  return { ...flow, server, base: `http://127.0.0.1:${address.port}` };
}
function rpc(name: string, args: unknown, id = 1) { return { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }; }
async function post(base: string, body: unknown, bearer?: string, abort?: AbortSignal) {
  return fetch(base + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
    ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body), ...(abort ? { signal: abort } : {}) });
}
const write = (text = literal) => ({ request_id: 'protocol_request_001', text, valid_until: new Date(Date.now() + 60000).toISOString() });
const structured = (result: unknown) => (result as { structuredContent: Record<string, unknown> }).structuredContent;

test('authenticated file schemas and bounded MCP pages reconstruct exact bytes with no source path grant', async (t) => {
  const { base, store, directory, adapter } = await fixture(t);
  const original = Buffer.from('\ufeff' + 'a'.repeat(READ_LIMIT - 5) + '🚀雪é\r\n' + literal.repeat(4000));
  const selected = join(directory, 'PRIVATE_CONTEXT_SOURCE'); await writeFile(selected, original);
  const item = store.captureFile(await readSelectedFile(selected));
  await unlink(selected);
  const bearer = await token();
  const client = new Client({ name: 'synthetic-local-file-client', version: '0.0.0' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), { requestInit: { headers: { Authorization: `Bearer ${bearer}` } } }));
  const { tools } = await client.listTools();
  const descriptor = tools.find((tool) => tool.name === 'read_shared_item')!;
  assert.match(descriptor.description!, /existing execution\/file tools/);
  assert.match(descriptor.description!, /SHA-256/); assert.match(descriptor.description!, /BOM/);
  const listing = structured(await client.callTool({ name: 'list_shared_items', arguments: { limit: 1 } }));
  assert.equal((listing.items as { kind: string }[])[0]!.kind, 'file');
  const parts: Buffer[] = [];
  let offset = 0;
  while (true) {
    const page = structured(await client.callTool({ name: 'read_shared_item', arguments: { id: item.id, offset } }));
    assert.equal(page.kind, 'file'); assert.equal(page.sha256, item.sha256);
    const bytes = Buffer.from(page.text as string); assert.ok(bytes.length <= READ_LIMIT);
    assert.deepEqual(bytes, original.subarray(offset, page.nextOffset as number));
    assert.equal(JSON.stringify(page).includes(selected), false);
    parts.push(bytes); offset = page.nextOffset as number;
    if (page.complete) break;
  }
  const reconstructed = Buffer.concat(parts);
  assert.deepEqual(reconstructed, original);
  assert.equal(createHash('sha256').update(reconstructed).digest('hex'), item.sha256);
  for (const unauthorized of [undefined, await token({ sub: 'other-owner' }), await token({ iat: 1, exp: 2 })]) {
    assert.ok([401, 403].includes((await post(base, rpc('read_shared_item', { id: item.id }), unauthorized)).status));
  }
  assert.equal((await (await post(base, rpc('read_shared_item', { id: item.id }), await token({ scope: config.statusScope }))).json()).result.isError, true);
  for (const args of [{ id: item.id, offset: 1 }, { id: selected }, { id: item.id, path: selected }, { id: item.id, max_bytes: READ_LIMIT + 1 }]) {
    const data = await (await post(base, rpc('read_shared_item', args), bearer)).json();
    assert.ok(data.error || data.result?.isError); assert.equal(data.result?.structuredContent, undefined);
  }
  store.revoke(item.id);
  assert.equal((await client.callTool({ name: 'read_shared_item', arguments: { id: item.id, offset: 3 } })).isError, true);
  assert.equal(adapter.reads, 0); assert.equal(adapter.writes, 0);
});

test('official SDK text flow validates structured results, scoped metadata and literal byte preservation', async (t) => {
  const { base, bridge, adapter, directory } = await fixture(t);
  const item = await bridge.capture();
  const bearer = await token({ scope: `${config.statusScope} ${config.readScope} ${config.writeScope}` });
  const client = new Client({ name: 'synthetic-local-text-client', version: '0.0.0' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), { requestInit: { headers: { Authorization: `Bearer ${bearer}` } } }));
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name), ['get_bridge_status', 'read_synthetic_probe', 'list_shared_items', 'read_shared_item', 'copy_text_to_mac']);
  const wire = await post(base, { jsonrpc: '2.0', id: 5, method: 'tools/list' }, bearer);
  for (const tool of (await wire.json()).result.tools) {
    assert.deepEqual(tool.securitySchemes, tool._meta.securitySchemes);
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.inputSchema.$schema, 'http://json-schema.org/draft-07/schema#');
    assert.equal(tool.annotations.openWorldHint, false);
    if (tool.name === 'copy_text_to_mac') {
      assert.deepEqual(tool.securitySchemes[0].scopes, [config.statusScope, config.writeScope]);
      assert.equal(tool.annotations.readOnlyHint, false); assert.equal(tool.annotations.destructiveHint, true); assert.equal(tool.annotations.idempotentHint, true);
    }
  }
  const status = await client.callTool({ name: 'get_bridge_status', arguments: {} });
  assert.equal(structured(status).mode, 'explicit-text-bridge');
  assert.equal(structured(status).macClipboard, 'test-adapter');
  assert.equal(structured(status).liveMacClipboard, 'unverified');
  const list = await client.callTool({ name: 'list_shared_items', arguments: { limit: 1 } });
  assert.equal((structured(list).items as { id: string }[])[0]!.id, item.id);
  const read = await client.callTool({ name: 'read_shared_item', arguments: { id: item.id } });
  assert.equal(structured(read).text, literal);
  const input = write();
  const copied = await client.callTool({ name: 'copy_text_to_mac', arguments: input });
  assert.equal(structured(copied).state, 'completed');
  assert.deepEqual(adapter.value, Buffer.from(literal));
  adapter.value = Buffer.from('newer clipboard');
  const retried = await client.callTool({ name: 'copy_text_to_mac', arguments: input });
  assert.deepEqual(retried.structuredContent, copied.structuredContent);
  assert.equal(adapter.value.toString(), 'newer clipboard');
  assert.equal(adapter.writes, 1); assert.equal(adapter.reads, 1);
  assert.doesNotMatch(JSON.stringify([tools, status, list, read, copied]), new RegExp(directory));
  assert.equal(JSON.stringify([tools, status, list, read, copied]).includes(config.ownerSubject), false);
});

test('owner and per-tool read/write permissions apply to every protected message, including retries', async (t) => {
  const { base, store, adapter } = await fixture(t);
  const item = store.capture(Buffer.from(literal));
  const input = write();
  const protectedCalls = [rpc('list_shared_items', {}), rpc('read_shared_item', { id: item.id }), rpc('copy_text_to_mac', input)];
  for (const call of protectedCalls) {
    for (const bearer of [undefined, await token({ sub: 'non-owner' }), await token({ iat: 1, exp: 2 }), await token({ aud: 'https://wrong.invalid/mcp' })]) {
      assert.ok([401, 403].includes((await post(base, call, bearer)).status));
    }
    const response = await post(base, call, await token({ scope: config.statusScope }));
    const data = (await response.json()).result;
    assert.equal(data.isError, true); assert.ok(data._meta['mcp/www_authenticate']); assert.equal(data.structuredContent, undefined);
  }
  const readOnly = await token();
  assert.equal((await (await post(base, rpc('copy_text_to_mac', input), readOnly)).json()).result.isError, true);
  const writeOnly = await token({ scope: `${config.statusScope} ${config.writeScope}` });
  assert.equal((await (await post(base, rpc('read_shared_item', { id: item.id }), writeOnly)).json()).result.isError, true);
  assert.equal((await (await post(base, rpc('copy_text_to_mac', input), writeOnly)).json()).result.structuredContent.state, 'completed');
  assert.equal((await (await post(base, rpc('copy_text_to_mac', input), readOnly)).json()).result.isError, true);
  assert.equal(adapter.writes, 1); assert.equal(adapter.reads, 0);
});

test('input bounds, unavailable shares and path/clipboard/command attempts fail without returning data', async (t) => {
  const { base, store, adapter } = await fixture(t);
  const item = store.capture(Buffer.from(literal)); store.revoke(item.id);
  const bearer = await token({ scope: `${config.statusScope} ${config.readScope} ${config.writeScope}` });
  const calls = [rpc('read_shared_item', { id: item.id }), rpc('read_shared_item', { id: '00000000-0000-4000-8000-000000000000' }),
    rpc('read_shared_item', { id: '../private' }), rpc('read_shared_item', { id: item.id, path: '/private' }),
    rpc('read_shared_item', { id: item.id, max_bytes: READ_LIMIT + 1 }), rpc('list_shared_items', { limit: 101 }),
    rpc('copy_text_to_mac', write('x'.repeat(TEXT_LIMIT + 1))), rpc('copy_text_to_mac', write('🚀'.repeat(TEXT_LIMIT / 4 + 1))),
    rpc('copy_text_to_mac', write('\ud800')), rpc('read_clipboard', {}), rpc('execute_command', { command: 'never' })];
  for (const call of calls) {
    const data = await (await post(base, call, bearer)).json();
    assert.ok(data.error || data.result?.isError); assert.equal(JSON.stringify(data).includes(literal), false);
  }
  assert.equal(adapter.reads, 0); assert.equal(adapter.writes, 0);
  // The transport permits worst-case JSON escaping while the handler enforces decoded UTF-8 bytes.
  const escaped = '\u0000'.repeat(TEXT_LIMIT);
  const accepted = await (await post(base, rpc('copy_text_to_mac', write(escaped)), bearer)).json();
  assert.equal(accepted.result.structuredContent.state, 'completed');
  assert.equal(adapter.value.length, TEXT_LIMIT);
});

test('HTTP timeout/disconnection cancels writes; offline calls cannot create future delivery', async (t) => {
  for (const action of ['timeout', 'disconnect'] as const) {
    const { base, bridge, adapter, store, server } = await fixture(t, action === 'timeout' ? 80 : undefined);
    let arrived!: () => void;
    const started = new Promise<void>((resolve) => { arrived = resolve; });
    adapter.write = async (_bytes, signal) => {
      adapter.writes++; arrived();
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      throw new ClipboardFailure(true);
    };
    const input = write();
    const controller = new AbortController();
    const pending = post(base, rpc('copy_text_to_mac', input), await token({ scope: `${config.statusScope} ${config.writeScope}` }), controller.signal);
    const caught = pending.catch(() => undefined);
    await started;
    if (action === 'disconnect') controller.abort();
    const response = await caught;
    if (action === 'timeout') assert.equal(response!.status, 408);
    // stop waits for cancellation completion, rather than a timed polling assertion.
    await bridge.stop();
    assert.equal(store.receipt(input.request_id)!.state, 'uncertain');
    assert.equal(adapter.value.toString(), literal);
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    await assert.rejects(post(base, rpc('copy_text_to_mac', input), await token()));
    assert.equal(adapter.writes, 1);
  }
});
