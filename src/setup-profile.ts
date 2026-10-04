import { lstat, rename, rm } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { privateDirectory, readPrivateConfig } from './private-state.ts';
import { holocronHome, initConfig, linkConfig, linkedConfig } from './holocron-profile.ts';
import { writePairingJson } from './secret-enrollment.ts';
import { promptExecutable, readPairing, relayUrl } from './secret-pairing.ts';
import { buildSecretPrompt } from './secret-prompt-build.ts';
import { object, SecretFailure } from './secret-shapes.ts';
import { resolveTunnelExecutable } from './tunnel-executable.ts';

export const DEFAULT_RELAY = 'https://holocron.ashray.xyz/api/secrets';
export interface SetupProfile {
  version: 1; role: 'mac' | 'receiver'; relay: string; adminFile?: string; prompt?: string;
  macConfigs: string[]; receiverConfig?: string; localConfig?: string;
  tunnelProfile?: string; tunnelClient?: string; pendingMacDirectory?: string;
}
const pathKeys = ['adminFile', 'prompt', 'receiverConfig', 'localConfig', 'tunnelProfile', 'tunnelClient', 'pendingMacDirectory'] as const;
export async function readSetup(home: string): Promise<SetupProfile> {
  const p = object(JSON.parse((await readPrivateConfig(join(home, 'setup.json'))).toString('utf8')),
    ['version', 'role', 'relay', 'macConfigs', ...pathKeys]);
  if (p.version !== 1 || !['mac', 'receiver'].includes(String(p.role)) || typeof p.relay !== 'string' || !Array.isArray(p.macConfigs)) throw new SecretFailure('setup_invalid');
  relayUrl(p.relay);
  for (const key of pathKeys) if (p[key] !== undefined) canonicalPath(p[key]);
  for (const path of p.macConfigs) canonicalPath(path);
  if (p.role === 'mac' && (!p.adminFile || !p.prompt || !p.localConfig) || p.role === 'receiver' && (p.adminFile || p.prompt || p.localConfig || p.tunnelProfile || p.tunnelClient || p.macConfigs.length)) throw new SecretFailure('setup_invalid');
  return p as unknown as SetupProfile;
}
export function canonicalPath(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value || /[\x00-\x1f\x7f,]/.test(value)) throw new SecretFailure('unsafe_setup_path');
}
export async function saveSetup(home: string, profile: SetupProfile): Promise<void> {
  await privateDirectory(home);
  const temporary = join(home, `.setup-${randomUUID()}.json`);
  await writePairingJson(temporary, profile);
  try { await rename(temporary, join(home, 'setup.json')); } finally { await rm(temporary, { force: true }); }
}
export async function setupMac(home: string, flags: Record<string, string>, signal: AbortSignal): Promise<SetupProfile> {
  let previous: SetupProfile | undefined;
  try { previous = await readSetup(home); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (previous && previous.role !== 'mac') throw new SecretFailure('setup_role_conflict');
  if (previous && Object.keys(flags).length === 0) return previous;
  const adminFile = flags['--admin-file'] ?? previous?.adminFile;
  if (!adminFile) throw new SecretFailure('setup_needs_admin_file_use_trusted_local_credentials');
  canonicalPath(adminFile);
  // Validate references without exporting or logging their contents.
  const admin = (await readPrivateConfig(adminFile)).toString('utf8').trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(admin)) throw new SecretFailure('invalid_admin_file');
  const relay = flags['--relay'] ?? previous?.relay ?? DEFAULT_RELAY; relayUrl(relay);
  const tunnelProfile = flags['--tunnel-profile'] ?? previous?.tunnelProfile;
  let tunnelClient = flags['--tunnel-client'] ?? previous?.tunnelClient;
  if (Boolean(tunnelProfile) !== Boolean(tunnelClient)) throw new SecretFailure('setup_needs_tunnel_profile_and_client');
  if (tunnelProfile && tunnelClient) { canonicalPath(tunnelProfile); await readPrivateConfig(tunnelProfile); tunnelClient = await resolveTunnelExecutable(tunnelClient); }
  const reuse = flags['--mac-config']; const macConfigs = previous?.macConfigs.slice() ?? [];
  if (reuse) { canonicalPath(reuse); const pairing = await readPairing(reuse, 'mac'); if (pairing.relay !== relay) throw new SecretFailure('pairing_peer_mismatch'); if (!macConfigs.includes(reuse)) macConfigs.push(reuse); }
  await privateDirectory(home);
  let prompt = flags['--prompt'] ?? previous?.prompt;
  let builtDirectory: string | undefined;
  if (prompt) await promptExecutable(prompt);
  else {
    // A failed build removes its owned destination, so setup is safely retryable.
    prompt = await buildSecretPrompt(join(home, 'native-prompt-v3'), signal);
    builtDirectory = join(home, 'native-prompt-v3');
  }
  try {
    let localConfig = flags['--local-config'] ?? previous?.localConfig;
    if (localConfig) await linkConfig(home, localConfig);
    else {
      try { localConfig = await linkedConfig(home); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; localConfig = await initConfig(home); }
    }
    const next: SetupProfile = { version: 1, role: 'mac', relay, adminFile, prompt, macConfigs, localConfig,
      ...(tunnelProfile ? { tunnelProfile, tunnelClient } : {}), ...(previous?.pendingMacDirectory ? { pendingMacDirectory: previous.pendingMacDirectory } : {}) };
    await saveSetup(home, next); return next;
  } catch (error) {
    // Only a helper newly built by this attempt is removed. Existing helpers,
    // linked Board configs and completed setup remain untouched on failure.
    if (builtDirectory) await rm(builtDirectory, { recursive: true });
    throw error;
  }
}
export async function savedReceiver(env = process.env): Promise<string> {
  const p = await readSetup(await holocronHome(env));
  if (p.role !== 'receiver' || !p.receiverConfig) throw new SecretFailure('setup_receiver_required');
  return p.receiverConfig;
}
export async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
