import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { BridgeFailure, TEXT_LIMIT } from './text.ts';

export async function boundedInput(input: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const iterator = input[Symbol.asyncIterator]();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new BridgeFailure('input_timeout')), 2000); });
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await Promise.race([iterator.next(), deadline]);
      if (next.done) return Buffer.concat(parts);
      size += next.value.byteLength;
      if (size > TEXT_LIMIT) throw new BridgeFailure('text_too_large');
      parts.push(next.value);
    }
  } finally {
    clearTimeout(timer);
    // Some streams cannot return until a pending read completes. Do not block failure on it.
    void iterator.return?.().catch(() => {});
  }
}

export async function cloudInputFile(path: string): Promise<Buffer> {
  try {
    const before = await lstat(path);
    if (!before.isFile()) throw new BridgeFailure('unsupported_file');
    if (before.size > TEXT_LIMIT) throw new BridgeFailure('text_too_large');
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const read = async () => {
        const info = await handle.stat();
        if (!info.isFile() || before.dev !== info.dev || before.ino !== info.ino || before.size !== info.size) throw new BridgeFailure('file_changed');
        const bytes = Buffer.alloc(before.size + 1);
        let size = 0;
        while (size <= before.size) {
          const { bytesRead } = await handle.read(bytes, size, bytes.length - size, size);
          if (bytesRead === 0) break;
          size += bytesRead;
        }
        const after = await handle.stat();
        if (size !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new BridgeFailure('file_changed');
        return bytes.subarray(0, size);
      };
      return await Promise.race([read(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new BridgeFailure('input_timeout')), 2000);
      })]);
    } finally { clearTimeout(timer); await handle.close(); }
  } catch (error) {
    if (error instanceof BridgeFailure) throw error;
    throw new BridgeFailure('file_unavailable');
  }
}
