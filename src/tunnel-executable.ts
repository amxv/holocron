import { realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { promptExecutable } from './secret-pairing.ts';
import { SecretFailure } from './secret-shapes.ts';

export async function validateTunnelExecutable(path: string): Promise<void> {
  try { await promptExecutable(path); }
  catch { throw new SecretFailure('unsafe_tunnel_client'); }
}

export async function resolveTunnelExecutable(path: string): Promise<string> {
  try {
    if (!isAbsolute(path) || resolve(path) !== path || /[\x00-\x1f\x7f,]/.test(path)) throw new Error();
    // Package managers expose symlink launchers. Bind setup to their canonical
    // regular target; start validates that exact target rather than following a
    // subsequently retargeted launcher. Native approval helper rules stay strict.
    const target = await realpath(path);
    if (/[\x00-\x1f\x7f,]/.test(target)) throw new Error();
    await validateTunnelExecutable(target);
    return target;
  } catch { throw new SecretFailure('unsafe_tunnel_client'); }
}
