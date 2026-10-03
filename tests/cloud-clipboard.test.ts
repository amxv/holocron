import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile, readFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { CloudClipboard, cloudText } from '../src/cloud-clipboard.ts';
import type { CloudEnvironment } from '../src/cloud-clipboard.ts';
import { runCloud, spawnCloud } from '../src/cloud-process.ts';
import type { CloudCommand, CloudSpawner, CloudWorker, WorkerExit } from '../src/cloud-process.ts';
import { runCloudCli } from '../src/cloud-cli-main.ts';
import { boundedInput, cloudInputFile } from '../src/cloud-input.ts';
import { TEXT_LIMIT } from '../src/text.ts';
import { sha256 } from '../src/digest.ts';
import { literal, temporary } from './bridge-fixtures.ts';

function environment(): CloudEnvironment {
  return { platform: 'linux', env: { WAYLAND_DISPLAY: 'wayland-test', XDG_RUNTIME_DIR: '/test/session',
    CONTROL_PLANE_API_KEY: 'MUST_NOT_FORWARD', OAUTH_SECRET: 'MUST_NOT_FORWARD', WAYLAND_DEBUG: '1', LD_PRELOAD: '/never' },
    executable: async () => true, socket: async () => true };
}

function backend() {
  const calls: { command: CloudCommand; input: Uint8Array | undefined }[] = [];
  let value = Buffer.from(literal);
  let owner: CloudWorker | undefined;
  let finish: ((result: WorkerExit) => void) | undefined;
  let stopCount = 0;
  const spawner: CloudSpawner = (command, input, signal) => {
    calls.push({ command, input });
    if (input === undefined) return { fed: Promise.resolve(), done: Promise.resolve({ code: 0, signal: null, output: value }),
      running: () => false, stop: () => {} };
    value = Buffer.from(input);
    let active = true;
    let resolve!: (value: WorkerExit) => void;
    let reject!: (error: Error) => void;
    const done = new Promise<WorkerExit>((yes, no) => { resolve = yes; reject = no; });
    const stop = () => { if (active) { active = false; stopCount++; reject(new Error('controlled cancellation')); } };
    signal.addEventListener('abort', stop, { once: true });
    void done.finally(() => signal.removeEventListener('abort', stop)).catch(() => {});
    finish = (result) => { active = false; resolve(result); };
    owner = { fed: Promise.resolve(), done, running: () => active, stop };
    return owner;
  };
  return { calls, spawner, value: () => value, owner: () => owner, stops: () => stopCount,
    release: (code: number | null = 0, signal: NodeJS.Signals | null = null) => finish!({ code, signal, output: Buffer.alloc(0) }) };
}
async function* stdin(bytes: Buffer) { yield bytes.subarray(0, 2); yield bytes.subarray(2); }
const abort = () => new AbortController().signal;

test('probe checks only fresh standard prerequisites, never runs a clipboard process or claims the viewed desktop', async () => {
  const env = environment(); const controlled = backend();
  const adapter = new CloudClipboard(env, controlled.spawner);
  assert.deepEqual(await adapter.probe(), { backend: 'wayland', availability: 'candidate', viewedDesktop: 'unverified', clipboardAccess: 'unverified' });
  assert.equal(controlled.calls.length, 0);
  env.socket = async () => false;
  assert.equal((await adapter.probe()).reason, 'wayland_socket_missing');
  await assert.rejects(adapter.read(abort()), /wayland_socket_missing/);
  assert.equal(controlled.calls.length, 0);
  for (const [platform, vars, reason] of [
    ['darwin', env.env, 'unsupported_platform'], ['linux', {}, 'wayland_session_missing'],
    ['linux', { XDG_RUNTIME_DIR: 'relative', WAYLAND_DISPLAY: 'wayland-0' }, 'wayland_session_missing'],
    ['linux', { XDG_RUNTIME_DIR: '/test', WAYLAND_DISPLAY: '../private' }, 'wayland_session_missing'],
    ['linux', { XDG_RUNTIME_DIR: '/test', WAYLAND_DISPLAY: 'bad\0socket' }, 'wayland_session_missing'],
    ['linux', { DISPLAY: ':0' }, 'wayland_session_missing'],
  ] as const) {
    const probe = await new CloudClipboard({ ...environment(), platform, env: vars }, controlled.spawner).probe();
    assert.equal(probe.reason, reason); assert.equal(probe.availability, 'unavailable');
  }
  assert.equal((await new CloudClipboard({ ...environment(), executable: async () => false }, controlled.spawner).probe()).reason, 'wayland_binaries_missing');
  const paths: string[] = [];
  const absolute = { ...environment(), env: { XDG_RUNTIME_DIR: '/test', WAYLAND_DISPLAY: '/test/wayland' }, socket: async (path: string) => { paths.push(path); return true; } };
  await new CloudClipboard(absolute, controlled.spawner).probe(); assert.deepEqual(paths, ['/test/wayland']);
});

test('literal read/write uses fixed argv, safe environment and exact digest with a retained foreground owner', async () => {
  const controlled = backend(); const adapter = new CloudClipboard(environment(), controlled.spawner);
  const bytes = Buffer.from(literal);
  const read = await adapter.read(abort());
  assert.deepEqual(Buffer.from(read.text), bytes); assert.equal(read.sha256, sha256(bytes)); assert.equal(read.viewedDesktop, 'unverified');
  let emitted: Record<string, unknown> | undefined;
  const pending = adapter.write(bytes, sha256(bytes), abort(), (result) => {
    emitted = result;
    assert.equal(controlled.owner()!.running(), true);
    controlled.release();
  });
  assert.equal((await pending).reason, 'backend_released');
  assert.equal(emitted!.state, 'owned'); assert.equal(emitted!.lifetime, 'foreground-process');
  assert.equal(emitted!.sha256, sha256(bytes)); assert.deepEqual(controlled.value(), bytes);
  for (const { command, input } of controlled.calls) {
    assert.equal(command.executable, input === undefined ? '/usr/bin/wl-paste' : '/usr/bin/wl-copy');
    assert.deepEqual(command.args, input === undefined ? ['--no-newline', '--type', 'text/plain;charset=utf-8'] : ['--foreground', '--type', 'text/plain;charset=utf-8']);
    assert.deepEqual(command.env, { LANG: 'C.UTF-8', XDG_RUNTIME_DIR: '/test/session', WAYLAND_DISPLAY: 'wayland-test' });
  }
});

test('invalid UTF-8, binary, size, digest and cancellation fail before backend mutation', async () => {
  const controlled = backend(); const adapter = new CloudClipboard(environment(), controlled.spawner);
  for (const bytes of [Buffer.from([0xff]), Buffer.from([0]), Buffer.from([0x1b]), Buffer.from('x'.repeat(TEXT_LIMIT + 1))]) {
    await assert.rejects(adapter.write(bytes, sha256(bytes), abort(), () => assert.fail('owned')));
  }
  for (const digest of ['wrong', 'A'.repeat(64), '0'.repeat(64)]) {
    await assert.rejects(adapter.write(Buffer.from(literal), digest, abort(), () => assert.fail('owned')), /digest/);
  }
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(adapter.write(Buffer.from(literal), sha256(Buffer.from(literal)), cancelled.signal, () => assert.fail('owned')), /cancelled/);
  await assert.rejects(adapter.read(cancelled.signal), /cancelled/);
  assert.equal(controlled.calls.length, 0);
  assert.equal(cloudText(Buffer.from('\ufeff雪\r\n\t')), '\ufeff雪\r\n\t');
});

test('owner cancellation, abnormal release and early exit never claim persistent publication', async () => {
  for (const kind of ['cancel', 'session-loss', 'failed'] as const) {
    const controlled = backend(); const adapter = new CloudClipboard(environment(), controlled.spawner);
    const controller = new AbortController(); let owned = false;
    const ended = await adapter.write(Buffer.from(literal), sha256(Buffer.from(literal)), controller.signal, () => {
      owned = true;
      if (kind === 'cancel') controller.abort();
      else controlled.release(kind === 'failed' ? 1 : null, kind === 'session-loss' ? 'SIGTERM' : null);
    });
    assert.equal(owned, true); assert.equal(ended.state, 'ownership-ended');
    assert.equal(ended.reason, kind === 'cancel' ? 'cancelled' : 'backend_failed');
    if (kind === 'cancel') assert.equal(controlled.stops(), 1);
  }
  let stopped = 0;
  const early: CloudSpawner = () => ({ fed: Promise.resolve(), done: Promise.resolve({ code: 0, signal: null, output: Buffer.alloc(0) }),
    running: () => false, stop: () => { stopped++; } });
  await assert.rejects(new CloudClipboard(environment(), early).write(Buffer.from(literal), sha256(Buffer.from(literal)), abort(), () => assert.fail('owned')), /publication|ownership/);
  assert.equal(stopped, 1);
});

test('startup verification mismatch is bounded and stops its owner without printing captured unrelated bytes', async () => {
  const controlled = backend();
  const spawner: CloudSpawner = (command, input, signal) => input === undefined ?
    { fed: Promise.resolve(), done: Promise.resolve({ code: 0, signal: null, output: Buffer.from('unrelated') }), running: () => false, stop: () => {} } :
    controlled.spawner(command, input, signal);
  const started = Date.now();
  await assert.rejects(new CloudClipboard(environment(), spawner).write(Buffer.from(literal), sha256(Buffer.from(literal)), abort(), () => assert.fail('owned')), /publication_timeout/);
  assert.ok(Date.now() - started < 3500); assert.equal(controlled.stops(), 1);
});

test('explicit helper CLI stdin and hostile data filenames preserve Unicode/BOM and never execute transferred strings', async (t) => {
  const directory = await temporary(t);
  const filename = join(directory, '`never` $(touch SHOULD_NEVER_EXIST) $HOME.json');
  const bytes = Buffer.from(literal); await writeFile(filename, bytes);
  assert.deepEqual(await cloudInputFile(filename), bytes);
  const link = join(directory, 'link'); await symlink(filename, link);
  await assert.rejects(cloudInputFile(link), /unsupported_file/);
  await assert.rejects(cloudInputFile(directory), /unsupported_file/);
  await assert.rejects(cloudInputFile(join(directory, 'missing')), /file_unavailable/);
  const big = join(directory, 'big'); await writeFile(big, Buffer.alloc(TEXT_LIMIT + 1));
  await assert.rejects(cloudInputFile(big), /text_too_large/);
  for (const args of [['write', '--sha256', sha256(bytes)], ['write', '--sha256', sha256(bytes), '--file', filename]]) {
    const controlled = backend(); const lines: string[] = [];
    const code = await runCloudCli(args, { stdin: stdin(bytes), out: (line) => {
      lines.push(line); if (JSON.parse(line).state === 'owned') controlled.release();
    }, error: (line) => assert.fail(line) }, new CloudClipboard(environment(), controlled.spawner));
    assert.equal(code, 0); assert.equal(JSON.parse(lines[0]!).sha256, sha256(bytes)); assert.deepEqual(controlled.value(), bytes);
  }
  const controlled = backend(); const lines: string[] = [];
  assert.equal(await runCloudCli(['read'], { stdin: stdin(Buffer.alloc(0)), out: (line) => lines.push(line), error: assert.fail }, new CloudClipboard(environment(), controlled.spawner)), 0);
  const read = JSON.parse(lines[0]!); assert.deepEqual(Buffer.from(read.text), bytes);
  assert.equal(createHash('sha256').update(Buffer.from(read.text)).digest('hex'), read.sha256);
  await assert.rejects(readFile(join(directory, 'SHOULD_NEVER_EXIST')));
});

test('CLI rejects command/network/config selectors and invalid inputs without any backend process', async () => {
  const controlled = backend(); const adapter = new CloudClipboard(environment(), controlled.spawner);
  const bytes = Buffer.from(literal);
  for (const args of [['write', '--sha256', 'invalid'], ['write', '--sha256', '0'.repeat(64)],
    ['write', '--sha256', sha256(bytes), '--command', 'touch'], ['read', '--url', 'https://never.invalid'],
    ['probe', '--config', '/private'], ['watch'], ['write', '--file', '/anything']]) {
    const errors: string[] = [];
    assert.notEqual(await runCloudCli(args, { stdin: stdin(bytes), out: () => assert.fail('output'), error: (line) => errors.push(line) }, adapter), 0);
    assert.equal(errors.length, 1); assert.doesNotMatch(errors[0]!, /MUST_NOT_FORWARD|touch|\/private/);
  }
  assert.equal(controlled.calls.length, 0);
});

test('stdin is bounded across chunks and stalled input times out', async () => {
  assert.deepEqual(await boundedInput(stdin(Buffer.from(literal))), Buffer.from(literal));
  await assert.rejects(boundedInput(stdin(Buffer.alloc(TEXT_LIMIT + 1))), /text_too_large/);
  const stalled: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) };
  await assert.rejects(boundedInput(stalled), /input_timeout/);
});

test('real subprocess pipes bound output and deadline; spawn, exit, signal and cancellation failures are honest', async () => {
  const command = (source: string): CloudCommand => ({ executable: process.execPath, args: ['-e', source], env: {} });
  const bytes = Buffer.from(literal);
  const worker = spawnCloud(command('process.stdin.pipe(process.stdout)'), bytes, abort());
  await worker.fed; assert.deepEqual((await worker.done).output, bytes);
  assert.equal(worker.running(), false);
  for (const source of ['process.exit(2)', 'process.kill(process.pid,"SIGTERM")']) await assert.rejects(runCloud(command(source), abort()), /backend_failed/);
  await assert.rejects(runCloud({ executable: '/nonexistent-cloud-clipboard-test', args: [], env: {} }, abort()), /backend_unavailable/);
  await assert.rejects(runCloud(command(`process.stdout.write(Buffer.alloc(${TEXT_LIMIT + 1}))`), abort()), /output_too_large/);
  await assert.rejects(runCloud(command('setTimeout(() => {}, 10000)'), abort()), /backend_timeout/);
  await assert.rejects(runCloud(command('setTimeout(() => {}, 10000)'), AbortSignal.timeout(30)), /backend_cancelled/);
  const inputBlocked = spawnCloud(command('setTimeout(() => {}, 10000)'), Buffer.alloc(TEXT_LIMIT), AbortSignal.timeout(30));
  await assert.rejects(inputBlocked.done, /backend_cancelled/);
  await inputBlocked.fed.catch(() => {}); assert.equal(inputBlocked.running(), false);
});
