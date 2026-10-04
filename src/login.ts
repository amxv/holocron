import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.ts';
import { currentUid } from './private-state.ts';
import { BridgeFailure } from './text.ts';

export const LOGIN_LABEL = 'org.holocron.companion';
const LEGACY_LOGIN_LABEL = 'org.shared-clipboard.companion';
export interface LoginEnvironment { platform: string; home: string; node: string; cli: string }

function pathArgument(path: string): string {
  if (!isAbsolute(path) || resolve(path) !== path || path.length > 4096 || /[\u0000-\u001f\u007f\ufffe\uffff]|\p{Surrogate}/u.test(path)) {
    throw new BridgeFailure('unsafe_login_path');
  }
  return path;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
}
function unescapeXml(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos);/g, (entity) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[entity]!);
}

function plist(environment: LoginEnvironment, configPath: string, label = LOGIN_LABEL): string {
  const args = [environment.node, environment.cli, 'start', '--config', configPath];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- ${label === LEGACY_LOGIN_LABEL ? 'shared-clipboard' : 'holocron'} managed login v1; no shell or clipboard payload -->
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${args.map((arg) => `<string>${escapeXml(arg)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${escapeXml(environment.home)}</string>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><false/>
<key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>/dev/null</string>
<key>StandardErrorPath</key><string>/dev/null</string>
</dict></plist>
`;
}

// Validate every ancestor without changing permissions of existing user directories/jobs.
async function directories(path: string, create: boolean): Promise<boolean> {
  const uid = currentUid();
  let part = parse(path).root;
  for (const segment of path.slice(part.length).split('/').filter(Boolean)) {
    part = join(part, segment);
    if (create) {
      try { await mkdir(part, { mode: 0o700 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    let info;
    try { info = await lstat(part); }
    catch (error) { if (!create && (error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
    if (!info.isDirectory() || info.isSymbolicLink() ||
        ((info.mode & 0o022) !== 0 && !(info.uid === 0 && (info.mode & 0o1000) !== 0)) ||
        (part === path && info.uid !== uid)) throw new BridgeFailure('unsafe_login_directory');
  }
  return true;
}

async function installedFile(path: string, executable: boolean): Promise<void> {
  pathArgument(path);
  await directories(dirname(path), false);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.uid !== 0 && info.uid !== currentUid()) ||
      (info.mode & 0o022) !== 0 || (executable && (info.mode & 0o100) === 0)) throw new BridgeFailure('unsafe_login_executable');
}

async function ownedPlist(path: string, environment: LoginEnvironment, configPath: string, label = LOGIN_LABEL): Promise<string | undefined> {
  let handle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw new BridgeFailure('login_conflict'); }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.uid !== currentUid() || (info.mode & 0o777) !== 0o600 || info.nlink !== 1 || info.size > 32768) {
      throw new BridgeFailure('login_conflict');
    }
    const text = await handle.readFile('utf8');
    const match = /<key>ProgramArguments<\/key><array><string>([^<]*)<\/string><string>([^<]*)<\/string><string>start<\/string><string>--config<\/string><string>([^<]*)<\/string><\/array>/.exec(text);
    if (!match) throw new BridgeFailure('login_conflict');
    const node = pathArgument(unescapeXml(match[1]!));
    const cli = pathArgument(unescapeXml(match[2]!));
    if (unescapeXml(match[3]!) !== configPath || text !== plist({ ...environment, node, cli }, configPath, label)) {
      throw new BridgeFailure('login_conflict');
    }
    return text;
  } finally { await handle.close(); }
}

export async function loginAction(action: 'install' | 'status' | 'remove', configPath: string, supplied?: LoginEnvironment) {
  const environment = supplied ?? { platform: process.platform, home: await realpath(homedir()),
    node: await realpath(process.execPath), cli: fileURLToPath(new URL('./cli.js', import.meta.url)) };
  if (environment.platform !== 'darwin') throw new BridgeFailure('login_requires_macos');
  pathArgument(configPath); pathArgument(environment.home);
  const directory = join(environment.home, 'Library', 'LaunchAgents');
  const exists = await directories(directory, false);
  let label = LOGIN_LABEL;
  if (exists) {
    const present = async (name: string) => {
      try { await lstat(join(directory, name + '.plist')); return true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
    };
    const legacy = await present(LEGACY_LOGIN_LABEL);
    if (legacy && await present(LOGIN_LABEL)) throw new BridgeFailure('login_conflict');
    if (legacy) label = LEGACY_LOGIN_LABEL;
  }
  const path = join(directory, label + '.plist');
  const previous = exists ? await ownedPlist(path, environment, configPath, label) : undefined;
  if (action === 'install') {
    await loadConfig(configPath);
    if (process.versions.node !== '24.21.0') throw new BridgeFailure('login_requires_pinned_node');
    await installedFile(environment.node, true); await installedFile(environment.cli, false);
    const expected = plist(environment, configPath, label);
    if (previous && previous !== expected) throw new BridgeFailure('login_conflict');
    if (!previous) {
      await directories(directory, true);
      const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(expected); await handle.sync(); } finally { await handle.close(); }
    }
    return { nextLogin: 'enabled', launchd: 'unverified', currentCompanion: 'unchanged', label };
  }
  if (action === 'remove' && previous) {
    // Recheck the exact owned file before unlinking. Never recurse, signal a PID or touch other jobs.
    if (await ownedPlist(path, environment, configPath, label) !== previous) throw new BridgeFailure('login_conflict');
    await unlink(path);
  }
  return { nextLogin: action === 'status' && previous ? 'enabled' : 'disabled', launchd: 'unverified',
    currentCompanion: 'unchanged', label };
}
