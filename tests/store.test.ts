import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, link, mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { ShareStore } from '../src/store.ts';
import { ownerId } from '../src/auth.ts';
import { privateDirectory, stateDirectory } from '../src/private-state.ts';
import { BridgeFailure, READ_LIMIT, SHARE_TTL_MS, TEXT_LIMIT, literalBytes } from '../src/text.ts';
import { bridgeFixture, literal, temporary } from './bridge-fixtures.ts';
import { config } from './fixtures.ts';

test('explicit capture freezes exact UTF-8 bytes; no status, list or read accesses an unshared clipboard', async (t) => {
  const { bridge, adapter, store, directory } = await bridgeFixture(t);
  assert.equal(store.list().items.length, 0);
  assert.equal(bridge.status().sharedItems, 0);
  assert.equal(adapter.reads, 0);
  const item = await bridge.capture('Benign command');
  adapter.value = Buffer.from('unshared newer clipboard');
  assert.equal(store.read(item.id).text, literal);
  assert.equal(item.sha256, createHash('sha256').update(Buffer.from(literal)).digest('hex'));
  assert.equal(item.byteCount, Buffer.byteLength(literal));
  assert.equal(adapter.reads, 1);
  assert.equal(adapter.writes, 0);
  assert.equal(JSON.stringify([bridge.status(), store.list(), store.read(item.id)]).includes(directory), false);
});

test('UTF-8 ranges reconstruct without truncating characters; pagination is bounded and owner-scoped', async (t) => {
  const { store, directory } = await bridgeFixture(t);
  const text = 'a'.repeat(READ_LIMIT - 2) + '🚀雪é' + 'z'.repeat(READ_LIMIT);
  const item = store.capture(Buffer.from(text));
  let offset = 0;
  const parts: string[] = [];
  for (;;) {
    const page = store.read(item.id, offset);
    assert.ok(Buffer.byteLength(page.text) <= READ_LIMIT);
    parts.push(page.text);
    if (page.complete) break;
    assert.ok(page.nextOffset > offset);
    offset = page.nextOffset;
  }
  assert.equal(parts.join(''), text);
  assert.throws(() => store.read(item.id, READ_LIMIT - 1), /invalid_range/);
  assert.throws(() => store.read(item.id, 0, READ_LIMIT + 1), /invalid_range/);
  assert.throws(() => store.read(item.id, item.byteCount + 1), /invalid_range/);
  assert.equal(store.read(item.id, item.byteCount).text, '');
  for (let index = 0; index < 6; index++) store.capture(Buffer.from(String(index)), 'Snapshot ' + index);
  const ids: string[] = [];
  let cursor: string | undefined;
  do { const page = store.list(2, cursor); assert.ok(page.items.length <= 2); ids.push(...page.items.map((row) => row.id)); cursor = page.nextCursor ?? undefined; } while (cursor);
  assert.equal(new Set(ids).size, 7);
  assert.throws(() => store.list(101), /invalid_page/);
  assert.throws(() => store.list(1, '../private'), /invalid_page/);
  const other = await ShareStore.open(directory, 'a'.repeat(64));
  try {
    assert.deepEqual(other.list().items, []);
    assert.throws(() => other.read(item.id), /share_unavailable/);
    assert.equal(other.revoke(item.id), false);
    assert.equal(other.clear(), 0);
  } finally { other.close(); }
});

test('invalid UTF-8, surrogate strings, oversize, unsafe names and aggregate overflow commit nothing', async (t) => {
  const { store } = await bridgeFixture(t, { aggregateLimit: 8 });
  for (const bytes of [Buffer.from([255]), Buffer.from([0xc3]), Buffer.from('a'.repeat(TEXT_LIMIT + 1))]) {
    assert.throws(() => store.capture(bytes), BridgeFailure);
  }
  assert.throws(() => literalBytes('\ud800'), /invalid_utf8/);
  for (const name of ['../private', '/Users/private', ' bad', 'bad\nlabel', 'bad\\name', '`exec`', 'x'.repeat(81)]) {
    assert.throws(() => store.capture(Buffer.from('ok'), name), /invalid_display_name/);
  }
  assert.equal(store.counts().sharedItems, 0);
  store.capture(Buffer.from('12345678'));
  assert.throws(() => store.capture(Buffer.from('x')), /storage_limit/);
  assert.deepEqual(store.counts(), { sharedItems: 1, sharedBytes: 8 });
});

test('expiry denies immediately, purges during normal service and on restart; revoke removes retained bytes', async (t) => {
  let now = Date.now();
  const directory = await temporary(t);
  const owner = ownerId(config);
  let store = await ShareStore.open(directory, owner, { now: () => now });
  const sentinel = 'UNIQUE_REVOKED_PAYLOAD_MUST_BE_REMOVED_04';
  const revoked = store.capture(Buffer.from(sentinel));
  assert.equal(store.revoke(revoked.id), true);
  assert.throws(() => store.read(revoked.id), /share_unavailable/);
  for (const file of await readdir(directory)) assert.equal((await readFile(join(directory, file))).includes(Buffer.from(sentinel)), false);
  const expired = store.capture(Buffer.from('expires immediately'));
  now += SHARE_TTL_MS;
  assert.throws(() => store.read(expired.id), /share_unavailable/);
  assert.equal(store.counts().sharedItems, 0);
  store.capture(Buffer.from('purged on restart'));
  store.close();
  now += SHARE_TTL_MS;
  store = await ShareStore.open(directory, owner, { now: () => now });
  assert.equal(store.counts().sharedItems, 0);
  store.close();
});

test('private state refuses unsafe permissions, symlinks, hardlinks and repository-local data', async (t) => {
  const directory = await temporary(t);
  await chmod(directory, 0o755);
  await assert.rejects(privateDirectory(directory));
  await chmod(directory, 0o700);
  const real = join(directory, 'real');
  await mkdir(real, { mode: 0o700 });
  await symlink(real, join(directory, 'symlink'));
  await assert.rejects(ShareStore.open(join(directory, 'symlink'), ownerId(config)));
  await assert.rejects(stateDirectory(join(process.cwd(), 'tmp-state')));
  const target = join(directory, 'target');
  await writeFile(target, '', { mode: 0o600 });
  await symlink(target, join(directory, 'bridge.sqlite'));
  await assert.rejects(ShareStore.open(directory, ownerId(config)));
  const hardDir = join(directory, 'hard'); await mkdir(hardDir, { mode: 0o700 });
  await link(target, join(hardDir, 'bridge.sqlite'));
  await assert.rejects(ShareStore.open(hardDir, ownerId(config)));
  const badDir = join(directory, 'bad'); await mkdir(badDir, { mode: 0o700 });
  await writeFile(join(badDir, 'bridge.sqlite'), '', { mode: 0o644 });
  await assert.rejects(ShareStore.open(badDir, ownerId(config)));
  const journalDir = join(directory, 'journal'); await mkdir(journalDir, { mode: 0o700 });
  await symlink(target, join(journalDir, 'bridge.sqlite-journal'));
  await assert.rejects(ShareStore.open(journalDir, ownerId(config)));
  const safe = join(directory, 'safe');
  const store = await ShareStore.open(safe, ownerId(config));
  store.close();
  assert.equal((await stat(safe)).mode & 0o777, 0o700);
  assert.equal((await stat(join(safe, 'bridge.sqlite'))).mode & 0o777, 0o600);
});
