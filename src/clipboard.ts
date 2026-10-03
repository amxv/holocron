import { spawn } from 'node:child_process';
import { BridgeFailure, TEXT_LIMIT, validUtf8 } from './text.ts';

export interface ClipboardAdapter {
  readonly availability: 'configured' | 'unavailable' | 'test-adapter';
  read(signal: AbortSignal): Promise<Buffer>;
  write(bytes: Uint8Array, signal: AbortSignal): Promise<void>;
}

export class ClipboardFailure extends Error {
  readonly uncertain: boolean;
  constructor(uncertain: boolean) { super('Clipboard operation did not complete'); this.uncertain = uncertain; }
}

export type ExecutableRunner = (executable: string, args: string[], input: Uint8Array | undefined, signal: AbortSignal) => Promise<Buffer>;

export const runExecutable: ExecutableRunner = (executable, args, input, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) { reject(new ClipboardFailure(false)); return; }
  // No shell or keyboard events. Only these fixed OS executables receive literal stdin/stdout data.
  const child = spawn(executable, args, { shell: false, stdio: ['pipe', 'pipe', 'ignore'],
    env: { ...process.env, LC_CTYPE: 'UTF-8' } });
  let dispatched = false;
  let timedOut = false;
  let total = 0;
  const parts: Buffer[] = [];
  const abort = () => { child.kill('SIGKILL'); };
  signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => { timedOut = true; abort(); }, 2000);
  child.once('spawn', () => { dispatched = true; if (signal.aborted) abort(); });
  child.stdout.on('data', (part: Buffer) => {
    total += part.length;
    if (total > TEXT_LIMIT) abort(); else parts.push(part);
  });
  child.stdin.on('error', () => {});
  child.once('error', () => { clearTimeout(timeout); signal.removeEventListener('abort', abort); reject(new ClipboardFailure(dispatched)); });
  child.once('close', (code) => {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
    if (code !== 0 || signal.aborted || timedOut || total > TEXT_LIMIT) reject(new ClipboardFailure(dispatched));
    else resolve(Buffer.concat(parts));
  });
  child.stdin.end(input);
});

export function macClipboard(runner: ExecutableRunner = runExecutable, platform = process.platform): ClipboardAdapter {
  const requireMac = () => { if (platform !== 'darwin') throw new ClipboardFailure(false); };
  return {
    availability: platform === 'darwin' ? 'configured' : 'unavailable',
    async read(signal) {
      requireMac();
      if (signal.aborted) throw new ClipboardFailure(false);
      const bytes = await runner('/usr/bin/pbpaste', ['-Prefer', 'txt'], undefined, signal);
      validUtf8(bytes);
      return bytes;
    },
    async write(bytes, signal) {
      requireMac();
      validUtf8(bytes);
      if (signal.aborted) throw new BridgeFailure('request_cancelled');
      await runner('/usr/bin/pbcopy', [], bytes, signal);
    },
  };
}
