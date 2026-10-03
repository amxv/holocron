import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import { homedir } from 'node:os';

export function currentUid(): number {
  if (!process.getuid || process.getuid() === 0) throw new Error('An unprivileged OS owner is required');
  return process.getuid();
}

export async function privateDirectory(path: string): Promise<string> {
  const uid = currentUid();
  if (!isAbsolute(path) || resolve(path) !== path) throw new Error('Canonical absolute state directory required');
  const root = parse(path).root;
  let part = root;
  for (const segment of path.slice(root.length).split('/').filter(Boolean)) {
    part = join(part, segment);
    try { await mkdir(part, { mode: 0o700 }); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const info = await lstat(part);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe state directory');
    if (part === path && (info.uid !== uid || (info.mode & 0o777) !== 0o700)) throw new Error('State directory must be owner-only');
    if ((info.mode & 0o022) !== 0 && !(info.uid === 0 && (info.mode & 0o1000) !== 0)) throw new Error('Unsafe state ancestor');
  }
  return path;
}

export async function privateFile(path: string, create = false, allowUnlinked = false): Promise<void> {
  const uid = currentUid();
  const handle = await open(path, constants.O_NOFOLLOW | constants.O_RDWR | (create ? constants.O_CREAT : 0), 0o600);
  try {
    const info = await handle.stat();
    // SQLite DELETE journals can be removed by another local process between
    // open and fstat. An already-unlinked private regular journal is harmless;
    // database/config files and retained hardlinks still require exactly one link.
    if (!info.isFile() || info.uid !== uid || (info.nlink !== 1 && !(allowUnlinked && info.nlink === 0)) || (info.mode & 0o777) !== 0o600) {
      throw new Error('Private regular owner-only file required');
    }
  } finally { await handle.close(); }
}

export async function stateDirectory(configured?: string): Promise<string> {
  const home = await realpath(homedir());
  const path = configured ?? join(home, 'Library', 'Application Support', 'shared-clipboard');
  const fromCwd = relative(resolve(process.cwd()), path);
  if (fromCwd === '' || (!fromCwd.startsWith('..' + '/') && !isAbsolute(fromCwd))) {
    throw new Error('State must be outside the working directory');
  }
  return privateDirectory(path);
}

export async function readPrivateConfig(path: string): Promise<Buffer> {
  // Opening with NOFOLLOW also prevents a config symlink from redirecting reads.
  if (!isAbsolute(path) || resolve(path) !== path) throw new Error('Absolute private config path required');
  const parent = await realpath(dirname(path));
  if (parent !== dirname(path)) throw new Error('Config ancestors cannot be symlinks');
  const info = await lstat(parent);
  if (info.uid !== currentUid() || (info.mode & 0o077) !== 0) throw new Error('Configuration directory must be owner-only');
  await privateFile(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if ((await handle.stat()).size > 16384) throw new Error('Configuration exceeds limit');
    return await handle.readFile();
  } finally { await handle.close(); }
}
