import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { test } from 'node:test';
import { ClipboardBridge } from '../src/bridge.ts';
import { ClipboardFailure } from '../src/clipboard.ts';
import { ShareStore } from '../src/store.ts';
import { ownerId } from '../src/auth.ts';
import { RECEIPT_TTL_MS, REQUEST_TTL_MS, TEXT_LIMIT } from '../src/text.ts';
import { bridgeFixture, literal, memoryClipboard, temporary } from './bridge-fixtures.ts';
import { config } from './fixtures.ts';

function request(now = Date.now(), id = 'unique_request_id_0001', text = literal) {
  return { request_id: id, text, valid_until: new Date(now + 60000).toISOString() };
}
const signal = () => new AbortController().signal;

test('exact retry returns original receipt without overwriting newer clipboard; mismatch fails', async (t) => {
  const { bridge, adapter, store, directory } = await bridgeFixture(t);
  const input = request();
  const receipt = await bridge.write(input, signal(), () => true);
  assert.equal(receipt.state, 'completed');
  assert.deepEqual(adapter.value, Buffer.from(literal));
  adapter.value = Buffer.from('newer unrelated clipboard');
  assert.deepEqual(await bridge.write(input, signal(), () => true), receipt);
  assert.equal(adapter.value.toString(), 'newer unrelated clipboard');
  assert.equal(adapter.writes, 1);
  for (const changed of [{ ...input, text: 'different' }, { ...input, valid_until: new Date(Date.now() + 61000).toISOString() }]) {
    await assert.rejects(bridge.write(changed, signal(), () => true), /request_conflict/);
  }
  assert.equal((await readFile(join(directory, 'bridge.sqlite'))).includes(Buffer.from(literal)), false);
  assert.equal(JSON.stringify(store.receipt(input.request_id)).includes(literal), false);
});

test('expired, overlong, malformed, unauthorized and stopped calls never reach OS or commit receipts', async (t) => {
  const { bridge, adapter, store } = await bridgeFixture(t);
  const now = Date.now();
  for (const input of [
    { ...request(), valid_until: new Date(now - 1).toISOString() },
    { ...request(), valid_until: new Date(now + REQUEST_TTL_MS + 10000).toISOString() },
    { ...request(), valid_until: 'not-a-date' }, { ...request(), request_id: '../path' },
    { ...request(), text: 'x'.repeat(TEXT_LIMIT + 1) }, { ...request(), text: '\ud800' },
  ]) await assert.rejects(bridge.write(input, signal(), () => true));
  await assert.rejects(bridge.write(request(), signal(), () => false));
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(bridge.write(request(), aborted.signal, () => true));
  await bridge.stop();
  await assert.rejects(bridge.write(request(), signal(), () => true), /bridge_unavailable/);
  assert.equal(adapter.writes, 0);
  assert.equal(store.receipt(request().request_id), undefined);
});

test('durable receipt survives restarts and cleanup cannot revive an expired envelope', async (t) => {
  let now = Date.now();
  const directory = await temporary(t);
  const adapter = memoryClipboard();
  let store = await ShareStore.open(directory, ownerId(config), { now: () => now });
  let bridge = new ClipboardBridge(store, adapter, () => now);
  const input = request(now);
  const receipt = await bridge.write(input, signal(), () => true);
  await bridge.stop(); store.close();
  now += 60001;
  store = await ShareStore.open(directory, ownerId(config), { now: () => now });
  bridge = new ClipboardBridge(store, adapter, () => now);
  assert.deepEqual(await bridge.write(input, signal(), () => true), receipt);
  assert.equal(adapter.writes, 1);
  now += RECEIPT_TTL_MS + 1;
  store.purge();
  assert.equal(store.receipt(input.request_id), undefined);
  await assert.rejects(bridge.write(input, signal(), () => true), /request_expired/);
  assert.equal(adapter.writes, 1);
  await bridge.stop(); store.close();
});

test('started receipts recover uncertain and never replay; known write failure also never retries', async (t) => {
  const { store, bridge, adapter } = await bridgeFixture(t);
  const input = request();
  const begin = store.beginReceipt.bind(store);
  // A persistent claim models a process interruption before any completion record exists.
  const { createHash } = await import('node:crypto');
  begin(input.request_id, createHash('sha256').update(JSON.stringify([input.text, input.valid_until])).digest('hex'), input.valid_until, Buffer.byteLength(input.text));
  const before = await bridge.write(input, signal(), () => true);
  assert.equal(before.state, 'uncertain');
  const nonce = store.acquireRuntime();
  assert.deepEqual(await bridge.write(input, signal(), () => true), before);
  store.releaseRuntime(nonce);
  assert.equal(adapter.writes, 0);
  adapter.write = async () => { throw new ClipboardFailure(false); };
  const failure = request(Date.now(), 'known_failed_request_01');
  const failed = await bridge.write(failure, signal(), () => true);
  assert.equal(failed.state, 'failed');
  adapter.write = async () => { throw new Error('must never replay'); };
  assert.deepEqual(await bridge.write(failure, signal(), () => true), failed);
});

test('persist-before-write failure prevents mutation; post-write persistence failure remains uncertain', async (t) => {
  const { bridge, adapter, store } = await bridgeFixture(t);
  const begin = store.beginReceipt;
  store.beginReceipt = () => { throw new Error('injected disk failure'); };
  const input = request();
  await assert.rejects(bridge.write(input, signal(), () => true));
  assert.equal(adapter.writes, 0);
  assert.equal(store.receipt(input.request_id), undefined);
  store.beginReceipt = begin;
  const finish = store.finishReceipt;
  store.finishReceipt = () => { throw new Error('injected commit failure'); };
  const uncertain = await bridge.write(input, signal(), () => true);
  assert.equal(uncertain.state, 'uncertain');
  assert.equal(store.receipt(input.request_id)!.state, 'started');
  assert.equal(adapter.writes, 1);
  store.finishReceipt = finish;
  assert.deepEqual(await bridge.write(input, signal(), () => true), uncertain);
  assert.equal(adapter.writes, 1);
});

test('concurrent duplicates join one write, distinct writes reject busy with no future queue', async (t) => {
  const { bridge, adapter, store } = await bridgeFixture(t);
  let release!: () => void;
  adapter.write = async (bytes, abort) => {
    adapter.writes++;
    await new Promise<void>((resolve) => { release = resolve; abort.addEventListener('abort', () => resolve(), { once: true }); });
    if (abort.aborted) throw new ClipboardFailure(true);
    adapter.value = Buffer.from(bytes);
  };
  const input = request();
  const one = bridge.write(input, signal(), () => true);
  const two = bridge.write(input, signal(), () => true);
  await assert.rejects(bridge.write(request(Date.now(), 'distinct_request_00002'), signal(), () => true), /clipboard_busy/);
  assert.equal(store.receipt('distinct_request_00002'), undefined);
  release();
  assert.deepEqual(await one, await two);
  assert.equal(adapter.writes, 1);
  const newer = bridge.write(request(Date.now(), 'distinct_request_00003', 'newer'), signal(), () => true);
  release();
  assert.equal((await newer).state, 'completed');
  await bridge.write(input, signal(), () => true);
  assert.equal(adapter.value.toString(), 'newer');
});

test('disconnect, stop and validity loss abort in-flight writes without delayed delivery', async (t) => {
  for (const condition of ['disconnect', 'stop', 'expiry', 'permission'] as const) {
    let now = Date.now();
    const { bridge, adapter } = await bridgeFixture(t, { now: () => now });
    let release!: () => void;
    let authorized = true;
    adapter.write = async (_bytes, abort) => {
      adapter.writes++;
      await new Promise<void>((resolve) => { release = resolve; abort.addEventListener('abort', () => resolve(), { once: true }); });
      if (abort.aborted) throw new ClipboardFailure(true);
    };
    const abort = new AbortController();
    const input = request(now, 'interrupt_request_' + condition);
    const pending = bridge.write(input, abort.signal, () => authorized);
    if (condition === 'disconnect') abort.abort();
    if (condition === 'stop') await bridge.stop();
    if (condition === 'expiry') { now += 61000; release(); }
    if (condition === 'permission') { authorized = false; release(); }
    const receipt = await pending;
    assert.equal(receipt.state, 'uncertain');
    assert.equal(adapter.value.toString(), literal);
    if (condition !== 'stop' && condition !== 'permission') assert.deepEqual(await bridge.write(input, signal(), () => true), receipt);
    assert.equal(adapter.writes, 1);
  }
});

test('an actual child-process interruption after adapter dispatch leaves a durable uncertain receipt', async (t) => {
  const directory = await temporary(t);
  const owner = ownerId(config);
  const input = request();
  const helper = join(directory, 'interrupt.mjs');
  const marker = join(directory, 'test-adapter-only');
  await writeFile(helper, `import { ShareStore } from ${JSON.stringify(pathToFileURL(resolve('src/store.ts')).href)};
import { ClipboardBridge } from ${JSON.stringify(pathToFileURL(resolve('src/bridge.ts')).href)};
import { writeFile } from 'node:fs/promises';
const store = await ShareStore.open(process.argv[2], process.argv[3]);
store.acquireRuntime();
const bridge = new ClipboardBridge(store, { availability: 'test-adapter', read: async () => { throw Error(); }, write: async (bytes) => { await writeFile(process.argv[4], bytes, { mode: 0o600 }); process.exit(79); } });
await bridge.write(JSON.parse(process.argv[5]), new AbortController().signal, () => true);
`, { mode: 0o600 });
  await assert.rejects(promisify(execFile)(process.execPath, [helper, directory, owner, marker, JSON.stringify(input)]), (error: unknown) =>
    typeof error === 'object' && error !== null && 'code' in error && error.code === 79);
  assert.deepEqual(await readFile(marker), Buffer.from(literal));
  const store = await ShareStore.open(directory, owner);
  assert.equal(store.receipt(input.request_id)!.state, 'started');
  const nonce = store.acquireRuntime();
  const adapter = memoryClipboard();
  const bridge = new ClipboardBridge(store, adapter);
  const receipt = await bridge.write(input, signal(), () => true);
  assert.equal(receipt.state, 'uncertain'); assert.equal(receipt.reason, 'interrupted'); assert.equal(adapter.writes, 0);
  store.releaseRuntime(nonce); await bridge.stop(); store.close();
});
