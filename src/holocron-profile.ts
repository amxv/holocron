import { constants } from 'node:fs';
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import { privateDirectory, readPrivateConfig } from './private-state.ts';
import { loadLocalConfig } from './local-config.ts';

export async function holocronHome(env = process.env): Promise<string> {
  let home = env.HOLOCRON_CLI_HOME ?? env.BOARD_CLI_HOME;
  if (home === undefined) {
    const config = join(await realpath(homedir()), '.config');
    home = join(config, 'holocron');
    // Reuse an existing profile in place. Never move or copy its linked config/secrets.
    try { await lstat(home); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const legacy = join(config, 'board');
      try { await lstat(legacy); home = legacy; }
      catch (legacyError) { if ((legacyError as NodeJS.ErrnoException).code !== 'ENOENT') throw legacyError; }
    }
  }
  if (!isAbsolute(home) || resolve(home) !== home) throw new Error('Invalid Holocron CLI home');
  return home;
}

export async function linkedConfig(home: string): Promise<string> {
  const profile = JSON.parse((await readPrivateConfig(join(home, 'cli.json'))).toString('utf8'));
  if (Object.keys(profile).length !== 1 || typeof profile.localConfig !== 'string' ||
      !isAbsolute(profile.localConfig) || resolve(profile.localConfig) !== profile.localConfig) throw new Error('Invalid Holocron link');
  return profile.localConfig;
}

export async function linkConfig(home: string, path: string): Promise<void> {
  await loadLocalConfig(path); // Config-only validation; never opens state or contacts a runtime.
  await privateDirectory(home);
  const destination = join(home, 'cli.json');
  try { await linkedConfig(home); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporary = join(home, `.cli-${process.pid}.json`);
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    await handle.writeFile(JSON.stringify({ localConfig: path }) + '\n');
    await handle.close();
    await rename(temporary, destination);
  } finally { await handle.close(); await unlink(temporary).catch(() => {}); }
}

export async function initConfig(home: string): Promise<string> {
  await privateDirectory(home);
  const path = join(home, 'local.json');
  // Never adopt or overwrite an existing runtime/config. Linking is a separate explicit action.
  for (const file of [path, join(home, 'cli.json')]) {
    try { await lstat(file); throw new Error('Existing Holocron configuration'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    await handle.writeFile(JSON.stringify({ transport: 'stdio', stateDirectory: join(home, 'state') }) + '\n');
    await handle.close();
    await linkConfig(home, path);
    return path;
  } catch (error) { await unlink(path); throw error; }
  finally { await handle.close(); }
}
