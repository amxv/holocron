import assert from 'node:assert/strict';
import { test } from 'node:test';
import { macClipboard, ClipboardFailure, runExecutable } from '../src/clipboard.ts';
import { literal } from './bridge-fixtures.ts';

test('native Mac adapter uses fixed executables and exact stdin/stdout bytes through an injected runner', async () => {
  const calls: { executable: string; args: string[]; input: Uint8Array | undefined }[] = [];
  const adapter = macClipboard(async (executable, args, input) => {
    calls.push({ executable, args, input });
    return input === undefined ? Buffer.from(literal) : Buffer.alloc(0);
  }, 'darwin');
  const abort = new AbortController().signal;
  assert.deepEqual(await adapter.read(abort), Buffer.from(literal));
  await adapter.write(Buffer.from(literal), abort);
  assert.deepEqual(calls, [
    { executable: '/usr/bin/pbpaste', args: ['-Prefer', 'txt'], input: undefined },
    { executable: '/usr/bin/pbcopy', args: [], input: Buffer.from(literal) },
  ]);
});

test('unsupported platform, invalid text and pre-cancelled operations never call the runner', async () => {
  let calls = 0;
  const run = async () => { calls++; return Buffer.from('x'); };
  const unsupported = macClipboard(run, 'linux');
  await assert.rejects(unsupported.read(new AbortController().signal), ClipboardFailure);
  await assert.rejects(unsupported.write(Buffer.from('x'), new AbortController().signal), ClipboardFailure);
  const native = macClipboard(run, 'darwin');
  await assert.rejects(native.write(Buffer.from([255]), new AbortController().signal));
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(native.write(Buffer.from('x'), cancelled.signal));
  assert.equal(calls, 0);
});

test('executable runner transports shell-like text literally, and cancellation/timeout/spawn errors fail', async () => {
  const bytes = Buffer.from(literal);
  assert.deepEqual(await runExecutable(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], bytes, new AbortController().signal), bytes);
  await assert.rejects(runExecutable('/nonexistent-shared-clipboard-test-executable', [], bytes, new AbortController().signal),
    (error: unknown) => error instanceof ClipboardFailure && !error.uncertain);
  await assert.rejects(runExecutable(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], undefined, AbortSignal.timeout(80)), ClipboardFailure);
  await assert.rejects(runExecutable(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], undefined, new AbortController().signal), ClipboardFailure);
});
