import { constants } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, open, readdir, realpath, rename, rm, readFile, unlink } from 'node:fs/promises';
import { isAbsolute, join, parse, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { currentUid, privateDirectory, readPrivateConfig } from './private-state.ts';

interface Installation {
  format: 1; version: string; digest: string; release: string; launcher: string; binDirectory: string; node: string;
}
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const canonical = (path: string) => isAbsolute(path) && resolve(path) === path && !/[\x00-\x1f\x7f]/.test(path);

async function binDirectory(path: string): Promise<void> {
  if (!canonical(path)) throw new Error('Bin directory must be a canonical absolute path');
  let part = parse(path).root;
  for (const segment of path.slice(part.length).split('/').filter(Boolean)) {
    part = join(part, segment);
    try { await mkdir(part, { mode: 0o755 }); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const info = await lstat(part);
    if (info.isSymbolicLink()) throw new Error('Bin directory cannot have symlink ancestors');
    if (!info.isDirectory() || (info.mode & 0o022) !== 0 && !(info.uid === 0 && (info.mode & 0o1000) !== 0)) throw new Error('Unsafe bin directory');
    if (part === path && info.uid !== currentUid()) throw new Error('Bin directory must belong to you');
  }
}

async function regularBytes(path: string): Promise<Buffer> {
  const info = await lstat(path);
  if (!info.isFile() || info.uid !== currentUid() || info.nlink !== 1 || (info.mode & 0o022) !== 0) throw new Error('Conflicting or unsafe holocron executable');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { return await file.readFile(); } finally { await file.close(); }
}

async function writeNew(path: string, text: string, mode: number): Promise<void> {
  const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, mode);
  try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
}

export async function installBundle(options: {
  prefix: string; bin: string; node: string; bundle: string; version: string; digest: string;
}): Promise<{ installed: true; version: string; unchanged: boolean }> {
  currentUid();
  const { prefix, bin, bundle, version, digest } = options;
  if (!canonical(prefix) || !canonical(bin) || !canonical(options.node) ||
      !/^\d+\.\d+\.\d+$/.test(version) || !/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid installation paths or release identity');
  if (process.version !== 'v24.21.0') throw new Error('Holocron requires Node 24.21.0');
  const node = await realpath(options.node);
  if (node !== await realpath(process.execPath)) throw new Error('Installer must pin its own verified Node executable');
  const manifest = JSON.parse(await readFile(join(bundle, 'package.json'), 'utf8'));
  if (manifest.name !== '@amxv/holocron' || manifest.version !== version || !manifest.private) throw new Error('Unexpected Holocron package');
  for (const file of ['dist/holocron.js', 'dist/cli.js', 'dist/cloud-cli.js']) {
    if (!(await lstat(join(bundle, file))).isFile()) throw new Error('Incomplete Holocron release');
  }
  await privateDirectory(prefix);
  const lock = join(prefix, '.install-lock');
  await writeNew(lock, String(process.pid), 0o600).catch(() => { throw new Error('Another installation is running, or its private lock needs inspection'); });
  const marker = join(prefix, '.holocron-install.json');
  const launcherPath = join(bin, 'holocron');
  let staged: string | undefined;
  const transaction = randomUUID();
  const stagedLauncher = join(bin, `.holocron-${transaction}`);
  const stagedMarker = join(prefix, `.marker-${transaction}`);
  let newRelease: string | undefined;
  let previous: Installation | undefined;
  let switched = false;
  let committed = false;
  try {
    try {
      previous = JSON.parse((await readPrivateConfig(marker)).toString('utf8')) as Installation;
      if (previous.format !== 1 || previous.binDirectory !== bin || typeof previous.launcher !== 'string' ||
          !/^[a-f0-9]{64}$/.test(previous.digest) || !/^\d+\.\d+\.\d+$/.test(previous.version) ||
          previous.release !== join(prefix, 'releases', `${previous.version}-${previous.digest}`)) throw new Error('Conflicting Holocron installation');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if ((await readdir(prefix)).some((name) => name !== '.install-lock')) throw new Error('Prefix is not an empty directory or a recognized Holocron CLI installation');
    }
    await binDirectory(bin);
    try {
      const existing = await regularBytes(launcherPath);
      if (!previous || hash(existing.toString('utf8')) !== hash(previous.launcher)) throw new Error('An unrelated or edited holocron executable already exists');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (previous) throw new Error('Managed holocron executable is missing; inspect the installation');
    }
    if (previous?.version === version && previous.digest !== digest) throw new Error('This version was already installed with different bytes; publish a new version');
    if (previous?.version === version && previous.digest === digest && previous.node === node) {
      if (!(await lstat(join(previous.release, 'dist/holocron.js'))).isFile()) throw new Error('Installed release is incomplete');
      return { installed: true, version, unchanged: true };
    }
    const releases = join(prefix, 'releases'); await privateDirectory(releases);
    if ((await readdir(releases)).some(name => name.startsWith(version + '-') && name !== `${version}-${digest}`)) {
      throw new Error('This version was already installed with different bytes; publish a new version');
    }
    const release = join(releases, `${version}-${digest}`);
    try { await lstat(release); await privateDirectory(release); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      staged = await mkdtemp(join(prefix, '.staged-'));
      const stagedPackage = join(staged, 'package');
      await cp(bundle, stagedPackage, { recursive: true, errorOnExist: true, force: false });
      await rename(stagedPackage, release); newRelease = release;
    }
    // Old version directories are retained for running processes and pinned tunnel commands.
    const launcher = `#!/bin/sh\n# Managed Holocron CLI; do not edit.\nexec ${quote(node)} ${quote(join(release, 'dist/holocron.js'))} "$@"\n`;
    const next: Installation = { format: 1, version, digest, release, launcher, binDirectory: bin, node };
    await writeNew(stagedLauncher, launcher, 0o755);
    await writeNew(stagedMarker, JSON.stringify(next) + '\n', 0o600);
    await rename(stagedLauncher, launcherPath); switched = true;
    await rename(stagedMarker, marker); committed = true;
    return { installed: true, version, unchanged: false };
  } finally {
    if (switched && !committed) {
      if (previous) { await writeNew(stagedLauncher, previous.launcher, 0o755); await rename(stagedLauncher, launcherPath); }
      else await unlink(launcherPath);
    }
    if (staged) await rm(staged, { recursive: true, force: true });
    await unlink(stagedLauncher).catch(() => {}); await unlink(stagedMarker).catch(() => {});
    if (newRelease && !committed) await rm(newRelease, { recursive: true, force: true });
    await unlink(lock);
  }
}
