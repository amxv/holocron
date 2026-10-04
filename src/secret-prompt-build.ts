import { spawn } from 'node:child_process';
import { chmod, copyFile, mkdir, realpath, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateDirectory } from './private-state.ts';
import { SecretFailure } from './secret-shapes.ts';

export async function buildSecretPrompt(directory: string, signal: AbortSignal): Promise<string> {
  if (process.platform !== 'darwin') throw new SecretFailure('mac_prompt_required');
  if (!isAbsolute(directory) || resolve(directory) !== directory || await realpath(dirname(directory)) !== dirname(directory)) throw new SecretFailure('unsafe_prompt_directory');
  await privateDirectory(dirname(directory)); await mkdir(directory, { mode: 0o700 });
  try {
    const output = join(directory, 'holocron-secrets-ui');
    const icon = join(directory, 'HolocronIcon.png');
    await copyFile(fileURLToPath(new URL('../native/HolocronIcon.png', import.meta.url)), icon);
    await chmod(icon, 0o600);
    const child = spawn('/usr/bin/swiftc', ['-O', '-framework', 'AppKit', fileURLToPath(new URL('../native/HolocronSecrets.swift', import.meta.url)), '-o', output], {
      stdio: 'ignore', shell: false, env: { PATH: '/usr/bin:/bin' }, signal,
    });
    await new Promise<void>((accept, reject) => {
      child.once('error', () => reject(new SecretFailure('prompt_build_failed')));
      child.once('close', (code) => code === 0 ? accept() : reject(new SecretFailure('prompt_build_failed')));
    });
    await chmod(output, 0o700); return output;
  } catch (error) { await rm(directory, { recursive: true }); throw error; }
}
