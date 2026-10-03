import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { readFile, readdir, symlink, truncate, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { readSelectedFile, nativeFileSource } from '../src/file-snapshot.ts';
import type { FileSource } from '../src/file-snapshot.ts';
import { ShareStore } from '../src/store.ts';
import { AGGREGATE_LIMIT, FILE_LIMIT, READ_LIMIT, SHARE_TTL_MS, TEXT_LIMIT } from '../src/text.ts';
import { bridgeFixture, literal, temporary } from './bridge-fixtures.ts';

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

test('selected files and explicitly selected symlinks freeze bytes without retaining a path grant', async (t) => {
  const { directory, store, adapter, bridge } = await bridgeFixture(t);
  const selected = join(directory, 'SECRET_SOURCE_NAME.txt');
  const unselected = join(directory, 'UNSELECTED.txt');
  const link = join(directory, 'selected-link');
  await writeFile(selected, literal);
  await writeFile(unselected, 'unselected secret');
  await symlink(selected, link);
  let resolves = 0;
  const bytes = await readSelectedFile(link, { ...nativeFileSource, async resolve(path) {
    resolves++;
    const resolved = await nativeFileSource.resolve(path);
    await unlink(link); await symlink(unselected, link);
    return resolved;
  } });
  const item = store.captureFile(bytes);
  assert.equal(resolves, 1);
  assert.equal(item.kind, 'file'); assert.equal(item.name, 'Context file');
  assert.equal(item.sha256, digest(Buffer.from(literal)));
  await writeFile(selected, 'modified original'); await unlink(selected);
  assert.equal(store.read(item.id).text, literal);
  assert.equal(store.list().items.length, 1);
  assert.throws(() => store.read(selected), /share_unavailable/);
  assert.throws(() => store.read(unselected), /share_unavailable/);
  const output = JSON.stringify([item, store.list(), store.read(item.id), bridge.status()]);
  for (const secret of [directory, selected, 'SECRET_SOURCE_NAME', 'unselected secret']) assert.equal(output.includes(secret), false);
  for (const path of await readdir(directory)) {
    if (path.startsWith('bridge.sqlite')) assert.equal((await readFile(join(directory, path))).includes(Buffer.from(selected)), false);
  }
  assert.equal(adapter.reads, 0); assert.equal(adapter.writes, 0);
});

test('multi-page file ranges preserve BOM and every UTF-8 boundary and digest', async (t) => {
  const { directory, store } = await bridgeFixture(t);
  const text = '\ufeff' + 'a'.repeat(READ_LIMIT - 5) + '🚀雪é\r\n' + ('café雪🚀\n'.repeat(16000));
  const bytes = Buffer.from(text);
  const selected = join(directory, 'large-context'); await writeFile(selected, bytes);
  const item = store.captureFile(await readSelectedFile(selected), 'Context fixture');
  assert.ok(bytes.length > TEXT_LIMIT);
  const parts: Buffer[] = [];
  let offset = 0;
  do {
    const page = store.read(item.id, offset);
    const part = Buffer.from(page.text);
    assert.ok(part.length <= READ_LIMIT); assert.equal(page.nextOffset, offset + part.length);
    assert.equal(page.sha256, item.sha256); assert.equal(page.kind, 'file');
    parts.push(part); offset = page.nextOffset;
    if (page.complete) break;
    assert.ok(part.length > 0);
  } while (true);
  assert.deepEqual(Buffer.concat(parts), bytes); assert.equal(digest(Buffer.concat(parts)), item.sha256);
  // Exercise arbitrary valid offsets and small limits, not only sequential pages.
  const positions = [0, 3, READ_LIMIT - 2, READ_LIMIT + 2, bytes.length - 1, bytes.length];
  for (const start of positions) for (const bound of [4, 5, 7, 31, READ_LIMIT]) {
    const page = store.read(item.id, start, bound);
    const part = Buffer.from(page.text);
    assert.deepEqual(part, bytes.subarray(start, page.nextOffset));
    assert.ok(part.length <= bound);
    assert.equal(page.complete, page.nextOffset === bytes.length);
  }
  for (const inside of [1, 2, READ_LIMIT - 1, READ_LIMIT, READ_LIMIT + 1]) assert.throws(() => store.read(item.id, inside), /invalid_range/);
  for (const invalid of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1, bytes.length + 1]) assert.throws(() => store.read(item.id, invalid), /invalid_range/);
  for (const invalid of [0, 3, 4.5, READ_LIMIT + 1]) assert.throws(() => store.read(item.id, 0, invalid), /invalid_range/);
  assert.throws(() => store.list(1, '../local/path'), /invalid_page/);
  const emptyPath = join(directory, 'empty'); await writeFile(emptyPath, '');
  const empty = store.captureFile(await readSelectedFile(emptyPath));
  assert.equal(store.read(empty.id).complete, true); assert.equal(store.read(empty.id).text, '');
});

test('unsupported paths, binary, invalid UTF-8 and oversize sources fail without a snapshot', async (t) => {
  const { directory, store } = await bridgeFixture(t);
  await assert.rejects(readSelectedFile(directory), /unsupported_file/);
  await assert.rejects(readSelectedFile('/dev/null'), /unsupported_file/);
  const fifo = join(directory, 'fifo'); await promisify(execFile)('mkfifo', [fifo]);
  await assert.rejects(readSelectedFile(fifo), /unsupported_file/);
  const socketPath = join(directory, 'socket');
  const socket = createServer(); socket.listen(socketPath); await once(socket, 'listening');
  try { await assert.rejects(readSelectedFile(socketPath), /unsupported_file/); }
  finally { await new Promise<void>((resolve) => socket.close(() => resolve())); }
  const path = join(directory, 'selected');
  for (const bytes of [Buffer.from([0xff]), Buffer.from([0xc3]), Buffer.from([0xc0, 0x80]), Buffer.from([0xed, 0xa0, 0x80])]) {
    await writeFile(path, bytes); await assert.rejects(readSelectedFile(path), /invalid_utf8/);
  }
  for (const text of ['plain\0binary', '%PDF\0fake', 'control\u001btext', '\u0085']) {
    await writeFile(path, text); await assert.rejects(readSelectedFile(path), /binary_file/);
    assert.throws(() => store.captureFile(Buffer.from(text)), /binary_file/);
  }
  await writeFile(path, ''); await truncate(path, FILE_LIMIT + 1);
  let opened = false;
  await assert.rejects(readSelectedFile(path, { ...nativeFileSource, async open(file, flags) {
    opened = true; return nativeFileSource.open(file, flags);
  } }), /file_too_large/);
  assert.equal(opened, false);
  await assert.rejects(readSelectedFile(join(directory, 'missing')), /^Error: file_unavailable$/);
  assert.equal(store.counts().sharedItems, 0);
});

test('file selection and in-place modification races fail closed; FIFO replacement never blocks open', async (t) => {
  const directory = await temporary(t);
  const path = join(directory, 'racy');
  for (const replacement of ['regular', 'symlink', 'fifo'] as const) {
    await writeFile(path, 'initial');
    const source: FileSource = { ...nativeFileSource, async open(file, flags) {
      await unlink(file);
      if (replacement === 'regular') await writeFile(file, 'changed');
      if (replacement === 'symlink') await symlink('/dev/null', file);
      if (replacement === 'fifo') await promisify(execFile)('mkfifo', [file]);
      return nativeFileSource.open(file, flags);
    } };
    await assert.rejects(readSelectedFile(path, source), /file_changed|file_unavailable|unsupported_file/);
    await unlink(path);
  }
  for (const mutation of ['overwrite', 'grow', 'shrink'] as const) {
    await writeFile(path, Buffer.alloc(READ_LIMIT + 17, 0x61));
    let mutated = false;
    const source: FileSource = { ...nativeFileSource, async open(file, flags) {
      const handle = await nativeFileSource.open(file, flags);
      return { ...handle, async read(buffer, offset, length, position) {
        const result = await handle.read(buffer, offset, length, position);
        if (!mutated) {
          mutated = true;
          if (mutation === 'overwrite') await writeFile(file, Buffer.alloc(READ_LIMIT + 17, 0x62));
          else await truncate(file, mutation === 'grow' ? FILE_LIMIT * 2 : 1);
        }
        return result;
      } };
    } };
    await assert.rejects(readSelectedFile(path, source), /file_changed/);
  }
});

test('source reads are positional and bounded even when a regular source keeps producing extra bytes', async (t) => {
  const directory = await temporary(t);
  const path = join(directory, 'bounded'); await writeFile(path, Buffer.alloc(READ_LIMIT * 2 + 1, 0x61));
  let readBytes = 0; let reads = 0; let closed = false;
  const source: FileSource = { ...nativeFileSource, async open(file, flags) {
    const handle = await nativeFileSource.open(file, flags);
    return { ...handle, async read(buffer, offset, length, position) {
      assert.equal(position, readBytes); assert.equal(offset, readBytes);
      assert.ok(length <= READ_LIMIT); assert.ok(buffer.length <= FILE_LIMIT + 1);
      reads++; readBytes += length; buffer.fill(0x61, offset, offset + length);
      return { bytesRead: length };
    }, async close() { closed = true; await handle.close(); } };
  } };
  await assert.rejects(readSelectedFile(path, source), /file_changed/);
  assert.equal(readBytes, READ_LIMIT * 2 + 2); assert.equal(reads, 3); assert.equal(closed, true);
});

test('10 MiB file and 100 MiB aggregate limits include text and other owners; expiry releases capacity', async (t) => {
  const { store, directory } = await bridgeFixture(t);
  assert.equal(AGGREGATE_LIMIT, 100 * 1024 * 1024);
  const bytes = Buffer.alloc(FILE_LIMIT, 0x61);
  const path = join(directory, 'maximum'); await writeFile(path, bytes);
  assert.deepEqual(await readSelectedFile(path), bytes);
  assert.throws(() => store.capture(bytes), /text_too_large/);
  assert.throws(() => store.captureFile(Buffer.alloc(FILE_LIMIT + 1)), /file_too_large/);
  const items = Array.from({ length: 10 }, () => store.captureFile(bytes));
  assert.equal(store.counts().sharedBytes, AGGREGATE_LIMIT);
  assert.throws(() => store.capture(Buffer.from('x')), /storage_limit/);
  const other = await ShareStore.open(directory, 'a'.repeat(64));
  try { assert.throws(() => other.captureFile(Buffer.from('x')), /storage_limit/); }
  finally { other.close(); }
  assert.equal(store.revoke(items[0]!.id), true);
  store.capture(Buffer.from('x')); store.captureFile(bytes.subarray(1));
  assert.equal(store.counts().sharedBytes, AGGREGATE_LIMIT);
  let now = Date.now();
  const expired = await bridgeFixture(t, { aggregateLimit: 3, now: () => now });
  expired.store.captureFile(Buffer.from('abc')); now += SHARE_TTL_MS;
  expired.store.captureFile(Buffer.from('def'));
  assert.deepEqual(expired.store.counts(), { sharedItems: 1, sharedBytes: 3 });
});

test('retained IDs, read offsets and list cursors cannot outlive revoke/expiry; bytes are securely removed', async (t) => {
  let now = Date.now();
  const { store, directory } = await bridgeFixture(t, { now: () => now });
  const other = await ShareStore.open(directory, store.owner, { now: () => now });
  const sentinel = 'FILE_REVOKE_SECRET_20261004_unique';
  const item = store.captureFile(Buffer.from(sentinel.repeat(3000)));
  const page = other.read(item.id, 0, 4);
  assert.equal(store.revoke(item.id), true);
  assert.throws(() => other.read(item.id, page.nextOffset), /share_unavailable/);
  assert.deepEqual(other.list(1, item.id).items, []);
  for (const path of await readdir(directory)) assert.equal((await readFile(join(directory, path))).includes(Buffer.from(sentinel)), false);
  const expired = store.captureFile(Buffer.from('FILE_EXPIRY_SECRET_unique'));
  now += SHARE_TTL_MS;
  assert.throws(() => other.read(expired.id, 0), /share_unavailable/);
  assert.equal(other.counts().sharedBytes, 0);
  for (const path of await readdir(directory)) assert.equal((await readFile(join(directory, path))).includes(Buffer.from('FILE_EXPIRY_SECRET_unique')), false);
  other.close();
});

test('competing local processes cannot overrun the aggregate limit even with different owners', async (t) => {
  const directory = await temporary(t);
  const script = `import {ShareStore} from ${JSON.stringify(pathToFileURL(resolve('src/store.ts')).href)};
    const store = await ShareStore.open(process.argv[1], process.argv[2], {aggregateLimit: 8});
    try { console.log(JSON.stringify(store.captureFile(Buffer.from('12345')))); }
    catch (error) { if (error.code !== 'storage_limit') throw error; console.log(JSON.stringify({error: error.code})); }
    finally { store.close(); }`;
  const run = promisify(execFile);
  const outputs = await Promise.all(Array.from({ length: 6 }, (_, index) => run(process.execPath,
    ['--input-type=module', '-e', script, directory, String(index).repeat(64)])));
  const results = outputs.map((output) => JSON.parse(output.stdout));
  assert.equal(results.filter((result) => result.id).length, 1);
  assert.equal(results.filter((result) => result.error === 'storage_limit').length, 5);
});
