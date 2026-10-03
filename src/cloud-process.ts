import { spawn } from 'node:child_process';
import { BridgeFailure, TEXT_LIMIT } from './text.ts';

export interface CloudCommand { executable: string; args: string[]; env: NodeJS.ProcessEnv }
export interface WorkerExit { code: number | null; signal: NodeJS.Signals | null; output: Buffer }
export interface CloudWorker {
  fed: Promise<void>;
  done: Promise<WorkerExit>;
  running(): boolean;
  stop(): void;
}
export type CloudSpawner = (command: CloudCommand, input: Uint8Array | undefined, signal: AbortSignal) => CloudWorker;

/** Literal pipes only. Environment is supplied by the backend's small allowlist. */
export const spawnCloud: CloudSpawner = (command, input, signal) => {
  const child = spawn(command.executable, command.args, { shell: false, env: command.env, stdio: ['pipe', 'pipe', 'ignore'] });
  let active = true;
  let size = 0;
  let failure: string | undefined;
  const parts: Buffer[] = [];
  const stop = () => { if (active) child.kill('SIGKILL'); };
  const abort = () => { failure = 'backend_cancelled'; stop(); };
  signal.addEventListener('abort', abort, { once: true });
  child.once('spawn', () => { if (signal.aborted) abort(); });
  child.stdout.on('data', (part: Buffer) => {
    size += part.length;
    if (size > TEXT_LIMIT) { failure = 'backend_output_too_large'; stop(); }
    else parts.push(part);
  });
  const fed = new Promise<void>((resolve, reject) => {
    child.stdin.once('error', () => reject(new BridgeFailure('backend_input_failed')));
    child.once('error', () => reject(new BridgeFailure('backend_unavailable')));
    child.stdin.end(input, () => resolve());
  });
  const done = new Promise<WorkerExit>((resolve, reject) => {
    child.once('error', () => { failure = 'backend_unavailable'; });
    child.once('close', (code, exitSignal) => {
      active = false;
      signal.removeEventListener('abort', abort);
      if (failure) reject(new BridgeFailure(failure));
      else resolve({ code, signal: exitSignal, output: Buffer.concat(parts) });
    });
  });
  // Both promises may reject while the caller is observing the other one.
  void fed.catch(() => {}); void done.catch(() => {});
  if (signal.aborted) abort();
  return { fed, done, running: () => active, stop };
};

export async function runCloud(command: CloudCommand, signal: AbortSignal, spawner = spawnCloud): Promise<Buffer> {
  const timeout = AbortSignal.timeout(2000);
  const worker = spawner(command, undefined, AbortSignal.any([signal, timeout]));
  try {
    const result = await worker.done;
    if (signal.aborted) throw new BridgeFailure('backend_cancelled');
    if (timeout.aborted) throw new BridgeFailure('backend_timeout');
    if (result.code !== 0 || result.signal) throw new BridgeFailure('backend_failed');
    return result.output;
  } catch (error) {
    if (timeout.aborted && !signal.aborted) throw new BridgeFailure('backend_timeout');
    throw error;
  } finally { worker.stop(); }
}
