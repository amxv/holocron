import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { mkdtemp, open, realpath, rm, lstat } from 'node:fs/promises';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentUid, privateDirectory } from './private-state.ts';
import { SECRET_FILE_MS, SecretFailure, names } from './secret-shapes.ts';
import { secretValues } from './secret-crypto.ts';

export async function secretRoot(): Promise<string> {
  return join(await realpath('/tmp'), `holocron-secrets-${currentUid()}`);
}
export async function validateSecretFiles(directory: string, expiry: number): Promise<void> {
  const root = await secretRoot();
  if (resolve(directory) !== directory || dirname(directory) !== root || !/^session-[A-Za-z0-9]+$/.test(basename(directory))) throw new SecretFailure('unsafe_secret_directory');
  await privateDirectory(root);
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== currentUid() || (info.mode & 0o777) !== 0o700) throw new SecretFailure('unsafe_secret_directory');
  const marker = await open(join(directory, '.expires'), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const state = await marker.stat();
    if (!state.isFile() || state.nlink !== 1 || state.uid !== currentUid() || (state.mode & 0o777) !== 0o600 || state.size > 32 ||
      Number(await marker.readFile('utf8')) !== expiry) throw new SecretFailure('unsafe_secret_directory');
  } finally { await marker.close(); }
}
export async function removeSecretFiles(directory: string, expiry: number): Promise<void> {
  await validateSecretFiles(directory, expiry); await rm(directory, { recursive: true });
}
export async function writeSecretFiles(values: Record<string, string>, options: {
  lifetime?: number; schedule?: (directory: string, expiry: number) => Promise<void>; signal?: AbortSignal;
} = {}): Promise<string> {
  const requested = Object.keys(values); names(requested); secretValues(values, requested);
  const root = await privateDirectory(await secretRoot());
  const directory = await mkdtemp(join(root, 'session-')); const expiry = Date.now() + (options.lifetime ?? SECRET_FILE_MS);
  try {
    for (const [name, value] of [...Object.entries(values), ['.expires', String(expiry)]]) {
      const handle = await open(join(directory, name!), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(value!); } finally { await handle.close(); }
    }
    await (options.schedule ?? scheduleCleanup)(directory, expiry);
    if (options.signal?.aborted) throw new SecretFailure('request_cancelled');
    return directory;
  } catch (error) { await rm(directory, { recursive: true }); throw error; }
}
async function scheduleCleanup(directory: string, expiry: number): Promise<void> {
  // A narrowly constrained cleanup child survives CLI exit, like Fidelius's existing cleanup worker.
  const child = spawn(process.execPath, [fileURLToPath(new URL('./secret-cleanup.js', import.meta.url)), directory, String(expiry)], {
    detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { PATH: '/usr/bin:/bin' },
  });
  await new Promise<void>((accept, reject) => {
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new SecretFailure('cleanup_unavailable')); }, 2000);
    child.once('error', () => { clearTimeout(timeout); reject(new SecretFailure('cleanup_unavailable')); });
    child.once('exit', () => { clearTimeout(timeout); reject(new SecretFailure('cleanup_unavailable')); });
    child.once('message', (message) => {
      clearTimeout(timeout);
      if ((message as { ready?: boolean })?.ready !== true) { child.kill('SIGKILL'); reject(new SecretFailure('cleanup_unavailable')); }
      else { child.disconnect(); accept(); }
    });
  });
  child.unref();
}
