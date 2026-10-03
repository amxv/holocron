import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { localOwnerId, loadLocalConfig } from '../src/local-config.ts';
import { ShareStore } from '../src/store.ts';
import { ownerId } from '../src/auth.ts';
import { config } from './fixtures.ts';
import { literal } from './bridge-fixtures.ts';
import { localFixture, writeRequest } from './stdio-fixtures.ts';

test('official SDK launches production CLI: STDIO discovery needs no provider; same-user sharing and revoke work', async (t) => {
  const f = await localFixture(t);
  const item = await f.cli('share-text', ['--name', 'Literal data'], literal);
  const selected = join(f.directory, 'PRIVATE_SOURCE'); await writeFile(selected, '\ufefffile\r\n雪🚀');
  const file = await f.cli('share-file', [selected]);
  const s = await f.sdk('success', true);
  assert.match(s.client.getInstructions()!, /Same-user execution/);
  const tools = await s.client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name), ['get_bridge_status', 'read_synthetic_probe', 'list_shared_items', 'read_shared_item', 'copy_text_to_mac']);
  const rawList = s.frames.find((frame) => 'result' in frame && Array.isArray(frame.result.tools));
  assert.ok(rawList && 'result' in rawList);
  for (const tool of rawList.result.tools as Array<Record<string, unknown>>) {
    assert.deepEqual(tool.securitySchemes, [{ type: 'noauth' }]);
    assert.deepEqual((tool._meta as Record<string, unknown>).securitySchemes, [{ type: 'noauth' }]);
    assert.equal(JSON.stringify(tool).includes('oauth2'), false);
  }
  const status = (await s.call('get_bridge_status')).structuredContent!;
  assert.equal(status.transport, 'stdio'); assert.equal(status.oauthProvider, 'not-required');
  assert.equal(status.trustBoundary, 'same-user-private-tunnel');
  assert.deepEqual(status.authorization, { ownerMatched: true, principalId: localOwnerId() });
  assert.equal((await s.call('read_shared_item', { id: item.id })).structuredContent!.text, literal);
  assert.equal((await s.call('read_shared_item', { id: file.id })).structuredContent!.text, '\ufefffile\r\n雪🚀');
  assert.equal((await s.call('read_shared_item', { id: selected })).isError, true);
  assert.equal((await f.cli('status')).transport, 'stdio');
  assert.equal((await stat(join(f.state, 'control.sock'))).mode & 0o777, 0o600);
  await f.cli('revoke', [item.id]);
  assert.equal((await s.call('read_shared_item', { id: item.id, offset: 4 })).isError, true);
  assert.equal((await f.cli('clear')).cleared, 1);
  assert.equal((await s.call('list_shared_items')).structuredContent!.items instanceof Array, true);
  assert.equal((await f.cli('stop')).localTransport, 'stopped');
  await s.client.close();
  assert.equal(s.stderr(), '');
  assert.deepEqual(await f.events(), []);
});

test('private STDIO owner stays separate from OAuth owner even in one database and forged metadata cannot choose owners', async (t) => {
  const f = await localFixture(t);
  const mine = await f.cli('share-text', [], 'local-only');
  const other = await ShareStore.open(f.state, ownerId(config));
  const oauthShare = other.capture(Buffer.from('OAUTH_PRIVATE_SENTINEL'));
  const expiredStore = await ShareStore.open(f.state, localOwnerId(), { now: () => Date.now() - 24 * 60 * 60 * 1000 - 1000 });
  const expired = expiredStore.capture(Buffer.from('expired')); expiredStore.close();
  const s = await f.sdk();
  const page = await s.client.request({ method: 'tools/call', params: { name: 'list_shared_items', arguments: {},
    _meta: { ownerMatched: true, principalId: ownerId(config), authorization: 'Bearer PRIVATE_TOKEN_SENTINEL' } } }, CallToolResultSchema);
  assert.deepEqual((page.structuredContent!.items as Array<{ id: string }>).map((item) => item.id), [mine.id]);
  assert.equal((await s.call('read_shared_item', { id: oauthShare.id })).isError, true);
  assert.equal((await s.call('read_shared_item', { id: expired.id })).isError, true);
  assert.equal(other.read(oauthShare.id).text, 'OAUTH_PRIVATE_SENTINEL');
  await f.cli('clear'); assert.equal(other.read(oauthShare.id).text, 'OAUTH_PRIVATE_SENTINEL');
  other.close();
  assert.equal(s.stderr(), '');
});

test('STDIO writes literal bytes, verifies original digest, and preserves exact receipts across process restart', async (t) => {
  const f = await localFixture(t);
  let s = await f.sdk();
  const request = { ...writeRequest('stdio_literal_receipt_01', literal), expected_sha256: createHash('sha256').update(literal).digest('hex') };
  assert.equal((await s.call('copy_text_to_mac', { ...request, text: 'altered' })).isError, true);
  assert.deepEqual(await f.events(), []);
  const first = (await s.call('copy_text_to_mac', request)).structuredContent!;
  assert.equal(first.state, 'completed');
  assert.deepEqual(Buffer.from((await f.events())[0].bytes, 'base64'), Buffer.from(literal));
  assert.deepEqual((await s.call('copy_text_to_mac', request)).structuredContent, first);
  assert.equal((await s.call('copy_text_to_mac', { ...request, text: 'different' })).isError, true);
  assert.equal((await s.call('copy_text_to_mac', writeRequest('stdio_large_payload_01', '雪'.repeat(90000)))).isError, true);
  assert.equal((await s.call('copy_text_to_mac', writeRequest('stdio_surrogate_input_01', '\ud800'))).isError, true);
  assert.equal((await s.call('copy_text_to_mac', { ...writeRequest('stdio_extra_field_01', literal), shell: true })).isError, true);
  assert.equal((await s.call('copy_text_to_mac', { ...writeRequest('stdio_expired_req_01', literal), valid_until: new Date(Date.now() - 1).toISOString() })).isError, true);
  assert.equal((await s.call('copy_text_to_mac', { ...writeRequest('stdio_long_deadline_01', literal), valid_until: new Date(Date.now() + 301000).toISOString() })).isError, true);
  await s.client.close();
  s = await f.sdk();
  assert.deepEqual((await s.call('copy_text_to_mac', request)).structuredContent, first);
  assert.equal((await f.events()).filter((event) => event.phase === 'dispatch').length, 1);
  await assert.rejects(stat(join(f.directory, 'SHOULD_NEVER_EXIST')));
  assert.equal(s.stderr(), '');
});

test('SDK concurrent duplicate writes join one receipt; distinct writes fail busy without queueing', async (t) => {
  const f = await localFixture(t); const s = await f.sdk('slow');
  const request = writeRequest('stdio_parallel_duplicate_01', literal);
  const same = Array.from({ length: 8 }, () => s.call('copy_text_to_mac', request));
  const other = s.call('copy_text_to_mac', writeRequest('stdio_parallel_distinct_01', 'different'));
  const responses = await Promise.all(same);
  for (const response of responses) assert.deepEqual(response.structuredContent, responses[0]!.structuredContent);
  assert.equal(responses[0]!.structuredContent!.state, 'completed');
  assert.equal((await other).isError, true);
  assert.equal((await f.events()).filter((event) => event.phase === 'dispatch').length, 1);
});

test('maximum escaped STDIO clipboard frame succeeds; decoded content, share/file and page limits still apply', async (t) => {
  const f = await localFixture(t); const s = await f.sdk();
  const text = '\u0000'.repeat(256 * 1024);
  const result = await s.call('copy_text_to_mac', writeRequest('stdio_max_escaped_01', text));
  assert.equal(result.structuredContent!.state, 'completed');
  assert.equal(result.structuredContent!.byteCount, 256 * 1024);
  assert.deepEqual(Buffer.from((await f.events())[0].bytes, 'base64'), Buffer.from(text));
  await assert.rejects(f.cli('share-text', [], 'x'.repeat(256 * 1024 + 1)), /text_too_large/);
  const selected = join(f.directory, 'oversize-file');
  await writeFile(selected, Buffer.alloc(10 * 1024 * 1024 + 1, 65));
  await assert.rejects(f.cli('share-file', [selected]), /file_too_large/);
  const item = await f.cli('share-text', [], '雪🚀');
  for (const args of [{ offset: 1 }, { max_bytes: 65537 }, { max_bytes: 3 }]) {
    assert.equal((await s.call('read_shared_item', { id: item.id, ...args })).isError, true);
  }
  assert.equal((await f.cli('list')).items.length, 1);
});

test('SDK cancellation preserves uncertainty and stops an in-flight write without replay', async (t) => {
  const f = await localFixture(t); const s = await f.sdk('blocked');
  const request = writeRequest('stdio_cancelled_write_01', literal);
  const abort = new AbortController();
  const pending = s.client.callTool({ name: 'copy_text_to_mac', arguments: request }, undefined, { signal: abort.signal });
  // Status calls cross the same child while the adapter has begun dispatch.
  for (let i = 0; i < 20 && !(await f.events()).length; i++) await s.call('get_bridge_status');
  assert.equal((await f.events())[0].phase, 'dispatch');
  abort.abort(); await assert.rejects(pending);
  const receipt = (await s.call('copy_text_to_mac', request)).structuredContent!;
  assert.equal(receipt.state, 'uncertain');
  assert.equal((await f.events()).filter((event) => event.phase === 'dispatch').length, 1);
  await s.client.close(); const restarted = await f.sdk();
  assert.deepEqual((await restarted.call('copy_text_to_mac', request)).structuredContent, receipt);
  assert.equal((await f.events()).filter((event) => event.phase === 'dispatch').length, 1);
});

test('adapter failures/unavailable and write timeout have durable non-replayable outcomes', async (t) => {
  const f = await localFixture(t);
  for (const mode of ['failure', 'unavailable', 'blocked']) {
    const s = await f.sdk(mode); const request = writeRequest('stdio_adapter_' + mode + '_01', literal);
    const response = await s.call('copy_text_to_mac', request);
    assert.equal(response.isError, true);
    if (mode !== 'unavailable') {
      assert.equal(response.structuredContent!.state, mode === 'failure' ? 'failed' : 'uncertain');
      assert.deepEqual((await s.call('copy_text_to_mac', request)).structuredContent, response.structuredContent);
    }
    await s.client.close();
  }
  assert.equal((await f.events()).filter((event) => event.phase === 'dispatch').length, 2);
});

test('STDIO singleton rejects second process; EOF/SIGTERM/SIGINT release lease without removing shares', async (t) => {
  const f = await localFixture(t); const item = await f.cli('share-text', [], literal);
  for (const signal of [undefined, 'SIGTERM', 'SIGINT'] as const) {
    const s = await f.sdk();
    const rejected = await f.run(process.execPath, [resolve('src/cli.ts'), 'stdio', '--local-config', f.configPath], { env: f.env })
      .then(() => assert.fail('Second runtime accepted'), (error: { stdout: string; stderr: string }) => error);
    assert.equal(rejected.stdout, ''); assert.match(rejected.stderr, /already_running/);
    if (signal) process.kill(s.pid!, signal);
    await s.client.close();
    assert.equal((await f.cli('status')).localTransport, 'stopped');
    const store = await ShareStore.open(f.state, localOwnerId());
    assert.equal(store.read(item.id).text, literal); store.close();
    assert.equal(s.stderr(), '');
  }
});

test('STDIO config/CLI fail closed: HTTP cannot use local config, local config cannot select OAuth or secrets', async (t) => {
  const f = await localFixture(t);
  assert.equal((await loadLocalConfig(f.configPath)).transport, 'stdio');
  await symlink(f.configPath, join(f.directory, 'link'));
  await assert.rejects(loadLocalConfig(join(f.directory, 'link')));
  await chmod(f.configPath, 0o644); await assert.rejects(loadLocalConfig(f.configPath)); await chmod(f.configPath, 0o600);
  const bad = join(f.directory, 'bad.json');
  for (const change of [{ transport: 'http' }, { issuer: 'https://provider.invalid' }, { token: 'SECRET_SENTINEL' }, { owner: ownerId(config) }, { stateDirectory: '.' }]) {
    await writeFile(bad, JSON.stringify({ transport: 'stdio', stateDirectory: f.state, ...change }), { mode: 0o600 });
    await assert.rejects(loadLocalConfig(bad));
  }
  for (const args of [
    ['start', '--local-config', f.configPath], ['login-install', '--local-config', f.configPath],
    ['stdio', '--config', f.configPath], ['stdio', '--local-config', f.configPath, '--config', f.configPath],
    ['stdio', '--local-config', f.configPath, '--local-config', f.configPath], ['stdio', '--local-config', f.configPath, '--port', '4317'],
    ['share-text', '--config', f.configPath], ['stdio', '--local-config', bad],
  ]) {
    const failure = await f.run(process.execPath, [resolve('src/cli.ts'), ...args], { env: f.env })
      .then(() => assert.fail('Unsafe arguments accepted'), (error: { stdout: string; stderr: string }) => error);
    assert.equal(failure.stdout, '');
    assert.doesNotMatch(failure.stderr, /SECRET_SENTINEL|provider\.invalid|local config\.json|bad\.json/);
  }
  assert.deepEqual(await f.events(), []);
  assert.equal(await readFile(f.configPath, 'utf8'), JSON.stringify({ transport: 'stdio', stateDirectory: f.state }));
});

test('STDIO stress reconstructs a 10 MiB snapshot and serves bounded concurrent pages amid process sharing/revocation', async (t) => {
  const f = await localFixture(t);
  const selected = join(f.directory, 'large-context');
  const text = '\ufeff' + '雪🚀\r\n'.repeat(1200000);
  const bytes = Buffer.from(text).subarray(0, 10 * 1024 * 1024 - 4);
  // End at a UTF-8 boundary; a final ASCII suffix makes the file exactly 10 MiB.
  let size = bytes.length;
  while ((bytes[size - 1]! & 0xc0) === 0x80) size--;
  const valid = Buffer.from(new TextDecoder().decode(bytes.subarray(0, size)).replace(/\ufffd$/, ''));
  const fileBytes = Buffer.concat([valid, Buffer.alloc(10 * 1024 * 1024 - valid.length, 65)]);
  await writeFile(selected, fileBytes);
  const file = await f.cli('share-file', [selected]);
  assert.equal(file.byteCount, 10 * 1024 * 1024);
  const s = await f.sdk();
  const parts: Buffer[] = []; let offset = 0;
  do {
    const page = (await s.call('read_shared_item', { id: file.id, offset })).structuredContent!;
    const part = Buffer.from(page.text as string);
    assert.ok(part.length <= 65536); assert.equal(page.nextOffset, offset + part.length);
    parts.push(part); offset = page.nextOffset as number;
    if (page.complete) break;
  } while (offset < file.byteCount);
  const rebuilt = Buffer.concat(parts);
  assert.deepEqual(rebuilt, fileBytes); assert.equal(createHash('sha256').update(rebuilt).digest('hex'), file.sha256);
  const captures = await Promise.all(Array.from({ length: 6 }, (_, i) => f.cli('share-text', ['--name', 'Share ' + i], literal)));
  for (let round = 0; round < 50; round++) {
    const responses = await Promise.all(Array.from({ length: 8 }, (_, i) => s.call('read_shared_item', { id: captures[i % 6]!.id, max_bytes: 64 })));
    for (const response of responses) assert.ok(Buffer.byteLength(response.structuredContent!.text as string) <= 64);
  }
  await Promise.all(captures.map((item) => f.cli('revoke', [item.id])));
  for (const item of captures) assert.equal((await s.call('read_shared_item', { id: item.id })).isError, true);
  assert.equal(s.stderr(), ''); assert.deepEqual(await f.events(), []);
});
