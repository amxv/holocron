import { createHash, randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { privateDirectory, privateFile } from './private-state.ts';
import { AGGREGATE_LIMIT, BridgeFailure, READ_LIMIT, RECEIPT_TTL_MS, SHARE_TTL_MS, contextUtf8, safeName, validUtf8 } from './text.ts';

export interface SharedItem {
  id: string; name: string; kind: 'text' | 'file'; byteCount: number; sha256: string; createdAt: string; expiresAt: string;
}
export interface ClipboardReceipt {
  request_id: string; state: 'completed' | 'failed' | 'uncertain'; byteCount: number;
  startedAt: string; finishedAt: string; reason?: string;
}
export interface StoredReceipt {
  request_id: string; fingerprint: string; valid_until: string; state: 'started' | ClipboardReceipt['state'];
  byteCount: number; startedAt: string; finishedAt: string | null; reason: string | null;
}

const fields = 'id, name, kind, byte_count AS byteCount, sha256, created_at AS createdAt, expires_at AS expiresAt';
const receiptFields = 'request_id, fingerprint, valid_until, state, byte_count AS byteCount, started_at AS startedAt, finished_at AS finishedAt, reason';
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export class ShareStore {
  private db: DatabaseSync;
  readonly directory: string;
  readonly owner: string;
  private now: () => number;
  private aggregateLimit: number;
  private constructor(db: DatabaseSync, directory: string, owner: string, now: () => number, aggregateLimit: number) {
    this.db = db; this.directory = directory; this.owner = owner; this.now = now; this.aggregateLimit = aggregateLimit;
  }

  static async open(directory: string, owner: string, options: { now?: () => number; aggregateLimit?: number } = {}): Promise<ShareStore> {
    if (!/^[a-f0-9]{64}$/.test(owner)) throw new BridgeFailure('invalid_owner');
    await privateDirectory(directory);
    const path = join(directory, 'bridge.sqlite');
    await privateFile(path, true);
    for (const suffix of ['-journal', '-wal', '-shm']) {
      try { await lstat(path + suffix); await privateFile(path + suffix, false, suffix === '-journal'); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    const db = new DatabaseSync(path, { timeout: 1000, allowExtension: false, defensive: true });
    try {
      // DELETE journals and secure_delete remove revoked bytes from retained pages and journals.
      db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;
        CREATE TABLE IF NOT EXISTS shares (
          id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
          byte_count INTEGER NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL, content BLOB NOT NULL);
        CREATE INDEX IF NOT EXISTS shares_owner_id ON shares(owner, id);
        CREATE TABLE IF NOT EXISTS receipts (
          owner TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, valid_until TEXT NOT NULL,
          state TEXT NOT NULL, byte_count INTEGER NOT NULL, started_at TEXT NOT NULL,
          finished_at TEXT, reason TEXT, PRIMARY KEY(owner, request_id));
        CREATE TABLE IF NOT EXISTS runtime (singleton INTEGER PRIMARY KEY CHECK(singleton=1), pid INTEGER NOT NULL, nonce TEXT NOT NULL);`);
      const store = new ShareStore(db, directory, owner, options.now ?? Date.now, options.aggregateLimit ?? AGGREGATE_LIMIT);
      store.purge();
      return store;
    } catch (error) { db.close(); throw error; }
  }

  close(): void { this.db.close(); }

  private transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = run(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  purge(): void {
    this.transaction(() => {
      const now = new Date(this.now()).toISOString();
      this.db.prepare('DELETE FROM shares WHERE expires_at <= ?').run(now);
      this.db.prepare("DELETE FROM receipts WHERE state != 'started' AND finished_at < ? AND valid_until < ?")
        .run(new Date(this.now() - RECEIPT_TTL_MS).toISOString(), now);
    });
  }

  capture(bytes: Uint8Array, name = 'Clipboard text'): SharedItem {
    validUtf8(bytes);
    return this.snapshot(bytes, 'text', name);
  }

  captureFile(bytes: Uint8Array, name = 'Context file'): SharedItem {
    contextUtf8(bytes);
    return this.snapshot(bytes, 'file', name);
  }

  private snapshot(bytes: Uint8Array, kind: SharedItem['kind'], name: string): SharedItem {
    safeName(name);
    this.purge();
    return this.transaction(() => {
      // A competing process or lock wait may cross an expiry after purge().
      this.db.prepare('DELETE FROM shares WHERE expires_at <= ?').run(new Date(this.now()).toISOString());
      const total = Number(this.db.prepare('SELECT COALESCE(SUM(byte_count),0) AS total FROM shares').get()!.total);
      if (total + bytes.byteLength > this.aggregateLimit) throw new BridgeFailure('storage_limit');
      const now = this.now();
      const item: SharedItem = { id: randomUUID(), name, kind, byteCount: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'), createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + SHARE_TTL_MS).toISOString() };
      this.db.prepare('INSERT INTO shares VALUES (?,?,?,?,?,?,?,?,?)').run(item.id, this.owner, item.name,
        item.kind, item.byteCount, item.sha256, item.createdAt, item.expiresAt, bytes);
      return item;
    });
  }

  list(limit = 20, cursor?: string): { items: SharedItem[]; nextCursor: string | null } {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (cursor !== undefined && !idPattern.test(cursor))) {
      throw new BridgeFailure('invalid_page');
    }
    this.purge();
    const items = this.db.prepare(`SELECT ${fields} FROM shares WHERE owner=? AND id>? AND expires_at>? ORDER BY id LIMIT ?`)
      .all(this.owner, cursor ?? '', new Date(this.now()).toISOString(), limit + 1) as unknown as SharedItem[];
    const hasMore = items.length > limit;
    if (hasMore) items.pop();
    return { items, nextCursor: hasMore ? items.at(-1)!.id : null };
  }

  read(id: string, offset = 0, maxBytes = READ_LIMIT) {
    if (!idPattern.test(id)) throw new BridgeFailure('share_unavailable');
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(maxBytes) || maxBytes < 4 || maxBytes > READ_LIMIT) {
      throw new BridgeFailure('invalid_range');
    }
    this.purge();
    // Metadata and bounded blob substring are read in one statement, so revocation cannot split the read.
    const row = this.db.prepare(`SELECT ${fields}, substr(content,?,?) AS chunk FROM shares WHERE id=? AND owner=? AND expires_at>?`)
      .get(offset + 1, maxBytes, id, this.owner, new Date(this.now()).toISOString()) as unknown as (SharedItem & { chunk: Uint8Array | null }) | undefined;
    if (!row) throw new BridgeFailure('share_unavailable');
    // SQLite substr() of an empty BLOB can yield NULL, unlike an end-range of
    // nonempty content. Treat only this empty range as a completed empty page.
    const chunk = row.chunk ?? new Uint8Array();
    if (offset > row.byteCount || (chunk.length && (chunk[0]! & 0xc0) === 0x80)) throw new BridgeFailure('invalid_range');
    let size = chunk.length;
    let text: string | undefined;
    for (let trim = 0; trim <= 3 && size >= 0; trim++, size--) {
      try { text = validUtf8(chunk.subarray(0, size), READ_LIMIT); break; } catch {}
    }
    if (text === undefined || (size === 0 && offset < row.byteCount)) throw new BridgeFailure('invalid_range');
    const { chunk: _chunk, ...item } = row;
    return { ...item, text, offset, nextOffset: offset + size, complete: offset + size === row.byteCount };
  }

  revoke(id: string): boolean {
    if (!idPattern.test(id)) throw new BridgeFailure('share_unavailable');
    this.purge();
    return Number(this.db.prepare('DELETE FROM shares WHERE id=? AND owner=?').run(id, this.owner).changes) > 0;
  }

  clear(): number { this.purge(); return Number(this.db.prepare('DELETE FROM shares WHERE owner=?').run(this.owner).changes); }

  counts(): { sharedItems: number; sharedBytes: number } {
    this.purge();
    const row = this.db.prepare('SELECT COUNT(*) AS sharedItems, COALESCE(SUM(byte_count),0) AS sharedBytes FROM shares WHERE owner=? AND expires_at>?')
      .get(this.owner, new Date(this.now()).toISOString())!;
    return { sharedItems: Number(row.sharedItems), sharedBytes: Number(row.sharedBytes) };
  }

  receipt(id: string): StoredReceipt | undefined {
    return this.db.prepare(`SELECT ${receiptFields} FROM receipts WHERE owner=? AND request_id=?`).get(this.owner, id) as unknown as StoredReceipt | undefined;
  }

  beginReceipt(id: string, fingerprint: string, validUntil: string, byteCount: number): void {
    this.transaction(() => {
      const count = Number(this.db.prepare('SELECT COUNT(*) AS count FROM receipts').get()!.count);
      if (count >= 50000) throw new BridgeFailure('receipt_capacity');
      this.db.prepare("INSERT INTO receipts VALUES (?,?,?,?, 'started', ?, ?, NULL, NULL)")
        .run(this.owner, id, fingerprint, validUntil, byteCount, new Date(this.now()).toISOString());
    });
  }

  finishReceipt(id: string, state: ClipboardReceipt['state'], reason?: string): ClipboardReceipt {
    const changed = this.db.prepare("UPDATE receipts SET state=?, finished_at=?, reason=? WHERE owner=? AND request_id=? AND state='started'")
      .run(state, new Date(this.now()).toISOString(), reason ?? null, this.owner, id);
    if (!changed.changes) throw new BridgeFailure('receipt_unavailable');
    return this.publicReceipt(this.receipt(id)!);
  }

  publicReceipt(receipt: StoredReceipt): ClipboardReceipt {
    return { request_id: receipt.request_id, state: receipt.state === 'started' ? 'uncertain' : receipt.state,
      byteCount: receipt.byteCount, startedAt: receipt.startedAt, finishedAt: receipt.finishedAt ?? receipt.startedAt,
      ...(receipt.reason ? { reason: receipt.reason } : receipt.state === 'started' ? { reason: 'interrupted' } : {}) };
  }

  acquireRuntime(): string {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT pid FROM runtime WHERE singleton=1').get();
      if (row) {
        try { process.kill(Number(row.pid), 0); throw new BridgeFailure('already_running'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
      }
      const nonce = randomUUID();
      this.db.prepare('INSERT OR REPLACE INTO runtime VALUES (1,?,?)').run(process.pid, nonce);
      this.db.prepare("UPDATE receipts SET state='uncertain', finished_at=started_at, reason='interrupted' WHERE state='started'").run();
      return nonce;
    });
  }

  releaseRuntime(nonce: string): void { this.db.prepare('DELETE FROM runtime WHERE singleton=1 AND nonce=?').run(nonce); }
}
