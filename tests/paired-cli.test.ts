import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import nacl from 'tweetnacl';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { temporary } from './bridge-fixtures.ts';
import { pairings, isolatedRedis } from './secret-fixtures.ts';
import { encode } from '../src/secret-crypto.ts';
import { writePairingJson } from '../src/secret-enrollment.ts';
import { secretRelay } from '../src/secret-relay.ts';
import { relayClient } from '../src/secret-client.ts';
import { saveSetup } from '../src/setup-profile.ts';

test('actual Mac/receiver CLI and BOTH MCP servers share exact encrypted snippets without clipboard access', async (t) => {
  const root = await temporary(t); const redis = await isolatedRedis(t);
  const fixture = pairings(); const admin = encode(nacl.randomBytes(32));
  const handler = secretRelay(redis, admin); const wire: string[] = [];
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []; for await (const part of req) chunks.push(part);
      const body = Buffer.concat(chunks).toString(); wire.push(body);
      const result = await handler(new Request('https://holocron.invalid/api/secrets', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: req.headers.authorization! }, body }));
      const json = await result.text(); wire.push(json);
      res.writeHead(result.status, { 'Content-Type': 'application/json' }); res.end(json);
    } catch { res.writeHead(503); res.end('{"error":"relay_unavailable"}'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>(accept => { server.closeAllConnections(); server.close(() => accept()); }));
  const address = server.address(); assert.ok(address && typeof address !== 'string');

  const homes = { mac: join(root, 'mac'), receiver: join(root, 'receiver') };
  const profiles = { mac: join(homes.mac, 'profile'), receiver: join(homes.receiver, 'profile') };
  for (const dir of [...Object.values(homes), ...Object.values(profiles)]) await mkdir(dir, { mode: 0o700 });
  const helper = join(homes.mac, 'helper'); await writeFile(helper, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const localConfig = join(profiles.mac, 'local.json');
  await writeFile(localConfig, JSON.stringify({ transport: 'stdio', stateDirectory: join(homes.mac, 'state') }), { mode: 0o600 });
  const macPairing = join(profiles.mac, 'mac.json');
  const receiverPairing = join(profiles.receiver, 'receiver.json');
  await writePairingJson(macPairing, { ...fixture.mac, prompt: helper });
  await writePairingJson(receiverPairing, fixture.receiver);
  await saveSetup(profiles.mac, { version: 1, role: 'mac', relay: fixture.mac.relay, adminFile: join(profiles.mac, 'admin'),
    prompt: helper, macConfigs: [macPairing], localConfig });
  await saveSetup(profiles.receiver, { version: 1, role: 'receiver', relay: fixture.receiver.relay,
    receiverConfig: receiverPairing, macConfigs: [] });
  const provision = relayClient({ ...fixture.mac, token: admin }, async (url, init) => handler(new Request(String(url), init)));
  await provision('provision', fixture.mac.channel);
  const hook = resolve('tests/secret-fetch-hook.ts'); const binary = resolve('dist/holocron.js');
  const env = (role: 'mac' | 'receiver') => ({
    PATH: process.env.PATH!, HOME: homes[role], HOLOCRON_CLI_HOME: profiles[role],
    HOLOCRON_TEST_RELAY_URL: 'http://127.0.0.1:' + address.port + '/api/secrets',
  });
  const run = async (role: 'mac' | 'receiver', args: string[], stdin = '') => {
    const child = spawn(process.execPath, ['--import', hook, binary, ...args], { env: env(role), cwd: homes[role], stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.stdin.end(stdin);
    const [status] = await once(child, 'exit');
    return { status, stdout, stderr, data: stdout.trim() ? JSON.parse(stdout) : null };
  };
  const peer = fixture.mac.channel.channel;
  assert.equal((await run('mac', ['peers'])).data.peers[0].peerId, peer);
  assert.equal((await run('receiver', ['peers'])).data.peers[0].name, 'Mac');
  const text = '\ufeffAgent -> Mac\n雪🚀\r\n';
  const sent = await run('receiver', ['send', '--name', 'Agent snippet'], text);
  assert.equal(sent.status, 0, sent.stderr);
  const macInbox = await run('mac', ['inbox']);
  assert.equal(macInbox.data.items[0].id, sent.data.id);
  const readMac = await run('mac', ['read', sent.data.id]);
  assert.equal(readMac.data.text, text); assert.equal(readMac.data.name, 'Agent snippet');
  assert.equal(wire.join('\n').includes(text), false);
  const back = await run('mac', ['send', '--name', 'Mac reply'], 'Mac -> Agent\n');
  assert.equal(back.status, 0, back.stderr);
  assert.equal((await run('receiver', ['read', back.data.id])).data.text, 'Mac -> Agent\n');
  assert.equal((await run('receiver', ['delete', back.data.id])).data.deleted, true);
  assert.equal((await run('receiver', ['read', back.data.id])).status, 1);

  const attach = async (role: 'mac' | 'receiver', args: string[]) => {
    const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', hook, binary, ...args],
      env: env(role), stderr: 'pipe' });
    const client = new Client({ name: 'paired-integration-test', version: '1' });
    await client.connect(transport);
    t.after(() => client.close());
    const call = (name: string, input: Record<string, unknown> = {}) => client.callTool({ name, arguments: input });
    return { client, call };
  };
  const agent = await attach('receiver', ['paired-mcp']);
  assert.deepEqual((await agent.client.listTools()).tools.map(tool => tool.name),
    ['list_paired_devices', 'send_paired_text', 'list_received_texts', 'read_received_text', 'delete_received_text']);
  const newMessage = await agent.call('send_paired_text', { name: 'Via receiver MCP', text: 'MCP literal 🚀' });
  assert.equal(newMessage.isError, undefined);
  const messageId = (newMessage.structuredContent as Record<string, unknown>).id as string;
  const macMcp = await attach('mac', ['stdio', '--local-config', localConfig]);
  const tools = (await macMcp.client.listTools()).tools.map(tool => tool.name);
  assert.equal(tools.includes('send_paired_text'), true);
  assert.equal(tools.includes('read_received_text'), true);
  const read = await macMcp.call('read_received_text', { id: messageId });
  assert.equal((read.structuredContent as Record<string, unknown>).text, 'MCP literal 🚀');
  const reply = await macMcp.call('send_paired_text', { name: 'Via Mac MCP', text: 'MCP return' });
  assert.equal(((await agent.call('read_received_text', { id: (reply.structuredContent as Record<string, unknown>).id })).structuredContent as Record<string, unknown>).text, 'MCP return');
  assert.equal(((await macMcp.call('delete_received_text', { id: messageId })).structuredContent as Record<string, unknown>).deleted, true);
  await macMcp.client.close(); await agent.client.close();
  assert.equal((await run('receiver', ['send'], 'x'.repeat(16385))).status, 1);
  assert.equal((await run('receiver', ['read', sent.data.id])).status, 1); // Sender cannot read its own outbound message.
  const revoke = await relayClient(fixture.mac, async (url, init) => handler(new Request(String(url), init)))('revoke', {});
  assert.equal(revoke.ok, true);
  assert.equal((await run('receiver', ['inbox'])).status, 1);
});
