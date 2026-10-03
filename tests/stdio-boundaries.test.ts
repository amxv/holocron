import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmod, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { BoundedStdioTransport, STDIO_FRAME_LIMIT } from '../src/stdio-transport.ts';
import { localFixture, writeRequest } from './stdio-fixtures.ts';
import { literal } from './bridge-fixtures.ts';

async function raw(t: TestContext, mode = 'success') {
  const f = await localFixture(t);
  const child = spawn(process.execPath, [resolve('tests/stdio-child.ts'), 'stdio', '--local-config', f.configPath],
    { env: { ...f.env, BOARD_TEST_MODE: mode }, stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 10000);
  child.once('exit', () => clearTimeout(watchdog));
  t.after(() => { clearTimeout(watchdog); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let stderr = ''; let stdout = ''; let protocolOnly = true;
  const frames: Record<string, unknown>[] = [];
  const waiters = new Map<string, (frame: Record<string, unknown>) => void>();
  child.stderr.on('data', (bytes: Buffer) => { stderr += bytes.toString(); });
  child.stdin.on('error', () => {});
  child.stdout.on('data', (bytes: Buffer) => {
    stdout += bytes.toString();
    let newline;
    while ((newline = stdout.indexOf('\n')) >= 0) {
      const line = stdout.slice(0, newline); stdout = stdout.slice(newline + 1);
      try {
        const frame = JSON.parse(line); frames.push(frame);
        const callback = waiters.get(String(frame.id)); waiters.delete(String(frame.id)); callback?.(frame);
      } catch { protocolOnly = false; }
    }
  });
  const send = (message: unknown) => child.stdin.write(JSON.stringify(message) + '\n');
  const wait = (id: number) => {
    const existing = frames.find((frame) => frame.id === id);
    if (existing) return Promise.resolve(existing);
    return new Promise<Record<string, unknown>>((resolve) => { waiters.set(String(id), resolve); });
  };
  const rpc = (id: number, method: string, params: unknown = {}) => {
    const response = wait(id);
    send({ jsonrpc: '2.0', id, method, params }); return response;
  };
  await rpc(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'raw-boundary-test', version: '1' } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const call = (id: number, name: string, args: unknown) => rpc(id, 'tools/call', { name, arguments: args });
  return { ...f, child, exited, send, rpc, call, wait, frames, stderr: () => stderr, protocolOnly: () => protocolOnly && stdout === '' };
}

test('malformed, invalid UTF-8, batches, overlong frames/IDs, duplicate IDs and request flood close STDIO without payload logs', async (t) => {
  const cases = [
    Buffer.from('{"PRIVATE_PAYLOAD_SENTINEL":\n'),
    Buffer.from([0xff, 10]),
    Buffer.from('[{"jsonrpc":"2.0","id":7,"method":"ping"}]\n'),
    Buffer.from('x'.repeat(STDIO_FRAME_LIMIT + 1)),
    Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 'x'.repeat(129), method: 'ping' }) + '\n'),
    Buffer.from([2, 2].map((id) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/list' })).join('\n') + '\n'),
    Buffer.from(Array.from({ length: 17 }, (_, i) => JSON.stringify({ jsonrpc: '2.0', id: i + 2, method: 'tools/list' })).join('\n') + '\n'),
  ];
  for (const bytes of cases) {
    const r = await raw(t); r.child.stdin.write(bytes);
    assert.equal((await r.exited)[0], 1);
    assert.equal(r.protocolOnly(), true);
    assert.equal(r.stderr(), 'stdio_transport_failed\n');
    assert.deepEqual(await r.events(), []);
    assert.equal((await r.cli('status')).localTransport, 'stopped');
  }
});

test('fragmented newline frames and unsupported methods work; trailing partial EOF fails safely', async (t) => {
  const r = await raw(t);
  const ping = Buffer.from('{"jsonrpc":"2.0","id":2,"method":"ping"}\n');
  const pong = r.wait(2);
  for (const byte of ping) r.child.stdin.write(Buffer.from([byte]));
  await pong;
  const unknown = await r.rpc(3, 'PRIVATE_UNSUPPORTED_METHOD');
  assert.equal((unknown.error as { code: number }).code, -32601);
  assert.equal(r.frames.some((frame) => frame.id === 2), true);
  r.child.stdin.end('{"PRIVATE_PARTIAL_SENTINEL');
  assert.equal((await r.exited)[0], 1);
  assert.equal(r.stderr(), 'stdio_transport_failed\n'); assert.equal(r.protocolOnly(), true);
});

test('JSON-RPC request ID zero cancellation suppresses response, preserves uncertain receipt and keeps channel usable', async (t) => {
  const r = await raw(t, 'blocked');
  const request = writeRequest('stdio_zero_cancel_01', literal);
  r.send({ jsonrpc: '2.0', id: 0, method: 'tools/call', params: { name: 'copy_text_to_mac', arguments: request } });
  for (let i = 0; i < 20 && !(await r.events()).length; i++) await r.call(10 + i, 'get_bridge_status', {});
  assert.equal((await r.events())[0].phase, 'dispatch');
  r.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 0 } });
  const retry = await r.call(40, 'copy_text_to_mac', request);
  assert.equal((retry.result as { structuredContent: { state: string } }).structuredContent.state, 'uncertain');
  assert.equal(r.frames.some((frame) => frame.id === 0), false);
  // Repeat cancellations with fresh IDs to expose RPC-slot leaks.
  for (let i = 0; i < 30; i++) {
    r.child.stdin.write([
      { jsonrpc: '2.0', id: i + 100, method: 'tools/call', params: { name: 'copy_text_to_mac', arguments: writeRequest('cancel_before_dispatch_' + i, literal) } },
      { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: i + 100 } },
    ].map((message) => JSON.stringify(message)).join('\n') + '\n');
    await r.rpc(i + 200, 'ping');
  }
  r.child.stdin.end(); assert.equal((await r.exited)[0], 0);
  assert.equal(r.stderr(), ''); assert.equal(r.protocolOnly(), true);
  assert.equal((await r.events()).filter((event) => event.phase === 'dispatch').length, 1);
});

test('EOF, signals and forced process death during write recover uncertain receipts without replay', async (t) => {
  for (const signal of ['EOF', 'SIGTERM', 'SIGINT', 'SIGKILL'] as const) {
    const r = await raw(t, 'blocked'); const request = writeRequest('stdio_interrupted_' + signal + '_01', literal);
    r.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'copy_text_to_mac', arguments: request } });
    for (let i = 0; i < 20 && !(await r.events()).length; i++) await r.call(10 + i, 'get_bridge_status', {});
    assert.equal((await r.events())[0].phase, 'dispatch');
    if (signal === 'EOF') r.child.stdin.end(); else r.child.kill(signal);
    const outcome = await r.exited;
    if (signal !== 'SIGKILL') assert.equal(outcome[0], 0);
    const s = await r.sdk();
    assert.equal((await s.call('copy_text_to_mac', request)).structuredContent!.state, 'uncertain');
    assert.equal((await r.events()).filter((event) => event.phase === 'dispatch').length, 1);
    assert.equal(r.protocolOnly(), true); assert.equal(r.stderr(), '');
  }
});

test('closed stdout tears down child and releases the runtime; bounded output rejects a stalled reader', async (t) => {
  const r = await raw(t); const shared = await r.cli('share-text', [], literal);
  r.child.stdout.destroy();
  r.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'read_shared_item', arguments: { id: shared.id } } });
  assert.equal((await r.exited)[0], 1);
  assert.equal((await r.cli('status')).localTransport, 'stopped');
  assert.equal(r.stderr(), 'stdio_transport_failed\n');

  const input = new PassThrough();
  const output = new Writable({ write(_bytes, _encoding, _callback) {} });
  const transport = new BoundedStdioTransport(input, output);
  let closed = 0; let errors = 0;
  transport.onclose = () => { closed++; }; transport.onerror = () => { errors++; };
  await transport.start();
  const sends = Array.from({ length: 6 }, (_, i) => transport.send({ jsonrpc: '2.0', id: i,
    result: { padding: 'x'.repeat(STDIO_FRAME_LIMIT - 100) } }));
  const results = await Promise.allSettled(sends);
  assert.ok(results.every((result) => result.status === 'rejected'));
  assert.equal(closed, 1); assert.equal(errors, 1);
  await transport.close(); input.destroy(); output.destroy();
});

test('unsafe state/database/control-socket paths cannot start STDIO or alter symlink targets', async (t) => {
  const f = await localFixture(t);
  const target = join(f.directory, 'PRIVATE_TARGET'); await writeFile(target, 'sentinel', { mode: 0o600 });
  await mkdir(f.state, { mode: 0o700 });
  for (const path of [join(f.state, 'bridge.sqlite'), join(f.state, 'control.sock')]) {
    await symlink(target, path);
    const failure = await f.run(process.execPath, [resolve('src/cli.ts'), 'stdio', '--local-config', f.configPath], { env: f.env })
      .then(() => assert.fail('Unsafe path accepted'), (error: { stdout: string; stderr: string }) => error);
    assert.equal(failure.stdout, ''); assert.doesNotMatch(failure.stderr, /PRIVATE_TARGET|sentinel/);
    assert.equal(await readFile(target, 'utf8'), 'sentinel');
    const { unlink } = await import('node:fs/promises'); await unlink(path);
  }
  await chmod(f.state, 0o755);
  await assert.rejects(f.cli('list'));
  await chmod(f.state, 0o700);
  await chmod(f.directory, 0o755); await assert.rejects(f.cli('list')); await chmod(f.directory, 0o700);
});
