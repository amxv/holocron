import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { TestContext } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult, JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { temporary } from './bridge-fixtures.ts';

export async function localFixture(t: TestContext) {
  const directory = await temporary(t);
  const configPath = join(directory, 'local config.json');
  const state = join(directory, 'state');
  const eventsPath = join(directory, 'events');
  await writeFile(configPath, JSON.stringify({ transport: 'stdio', stateDirectory: state }), { mode: 0o600 });
  await writeFile(eventsPath, '', { mode: 0o600 });
  const env = { PATH: process.env.PATH!, HOME: directory, BOARD_TEST_EVENTS: eventsPath };
  const cli = async (command: string, extra: string[] = [], text?: string) => {
    const child = execFile(process.execPath, [resolve('src/cli.ts'), command, ...extra, '--local-config', configPath],
      { env, maxBuffer: 1024 * 1024 });
    child.stdin!.end(text);
    const [stdout, stderr] = await new Promise<[string, string]>((resolve, reject) => {
      let out = ''; let error = '';
      child.stdout!.on('data', (value: Buffer) => { out += value.toString(); });
      child.stderr!.on('data', (value: Buffer) => { error += value.toString(); });
      child.on('error', reject);
      child.on('close', (code) => { if (code !== 0) reject(new Error(error)); else resolve([out, error]); });
    });
    assert.equal(stderr, '');
    return JSON.parse(stdout);
  };
  const events = async () => (await readFile(eventsPath, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const sdk = async (mode = 'success', production = false) => {
    const transport = new StdioClientTransport({ command: process.execPath,
      args: [resolve(production ? 'src/cli.ts' : 'tests/stdio-child.ts'), 'stdio', '--local-config', configPath],
      env: { ...env, BOARD_TEST_MODE: mode }, stderr: 'pipe' });
    let stderr = '';
    transport.stderr?.on('data', (bytes: Buffer) => { stderr += bytes.toString(); });
    const client = new Client({ name: 'official-sdk-subprocess-test', version: '1.0.0' });
    const frames: JSONRPCMessage[] = [];
    transport.onmessage = (message) => { frames.push(message); };
    client.onerror = () => {};
    await client.connect(transport);
    const pid = transport.pid;
    t.after(() => client.close());
    const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>;
    return { client, transport, call, stderr: () => stderr, pid, frames };
  };
  const run = promisify(execFile);
  return { directory, configPath, state, env, events, cli, sdk, run };
}

export const writeRequest = (id: string, text: string) => ({ request_id: id, text, valid_until: new Date(Date.now() + 60000).toISOString() });
