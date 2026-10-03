import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { BridgeFailure, FILE_LIMIT, READ_LIMIT, contextUtf8 } from './text.ts';

export interface FileSource {
  resolve(path: string): Promise<string>;
  inspect(path: string): Promise<BigIntStats>;
  open(path: string, flags: number): Promise<{
    inspect(): Promise<BigIntStats>;
    read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
    close(): Promise<void>;
  }>;
}

export const nativeFileSource: FileSource = {
  resolve: realpath,
  inspect: (path) => lstat(path, { bigint: true }),
  async open(path, flags) {
    const handle = await open(path, flags);
    return {
      inspect: () => handle.stat({ bigint: true }),
      read: (buffer, offset, length, position) => handle.read(buffer, offset, length, position),
      close: () => handle.close(),
    };
  },
};

function regular(info: BigIntStats): void {
  if (!info.isFile()) throw new BridgeFailure('unsupported_file');
  if (info.size > BigInt(FILE_LIMIT)) throw new BridgeFailure('file_too_large');
}

function unchanged(before: BigIntStats, after: BigIntStats): void {
  if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new BridgeFailure('file_changed');
}

/** Select once, open a regular inode, and retain only bounded immutable bytes. */
export async function readSelectedFile(path: string, source: FileSource = nativeFileSource): Promise<Buffer> {
  try {
    // Explicit symlinks resolve once. NOFOLLOW rejects a final symlink swapped in
    // afterward; NONBLOCK prevents a raced FIFO from hanging the local command.
    const selected = await source.resolve(path);
    const before = await source.inspect(selected);
    regular(before);
    const handle = await source.open(selected, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const opened = await handle.inspect();
      regular(opened);
      unchanged(before, opened);
      // One extra byte detects growth, including a source lying about its size.
      // Positional reads cannot chase an indefinitely growing file to EOF.
      const expected = Number(opened.size);
      const bytes = Buffer.alloc(expected + 1);
      let size = 0;
      while (size <= expected) {
        const { bytesRead } = await handle.read(bytes, size, Math.min(READ_LIMIT, bytes.length - size), size);
        if (bytesRead === 0) break;
        size += bytesRead;
        if (size > expected) throw new BridgeFailure('file_changed');
      }
      unchanged(opened, await handle.inspect());
      if (size !== expected) throw new BridgeFailure('file_changed');
      const snapshot = bytes.subarray(0, size);
      contextUtf8(snapshot);
      return snapshot;
    } finally { await handle.close(); }
  } catch (error) {
    // Filesystem errors can contain the original path. Return only safe codes.
    if (error instanceof BridgeFailure) throw error;
    throw new BridgeFailure('file_unavailable');
  }
}
