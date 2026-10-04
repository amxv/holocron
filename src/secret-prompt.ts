import { spawn } from 'node:child_process';
import { fingerprint } from './secret-crypto.ts';
import { SecretFailure, SECRET_PROMPT_LIMIT } from './secret-shapes.ts';
import type { SecretRequest } from './secret-shapes.ts';
import type { SecretPairing } from './secret-pairing.ts';
import type { PairApproval } from './secret-enrollment.ts';

export type SecretPrompt = (pairing: SecretPairing, request: SecretRequest, signal: AbortSignal) => Promise<unknown | null>;
export const nativeSecretPrompt: SecretPrompt = async (pairing, request, signal) => {
  return runPrompt(pairing.prompt!, [pairing.channel.recipient, fingerprint(pairing.channel.receiverSignPublic), request.id,
    request.purpose, new Date(request.expiresAt).toISOString(), ...request.names], signal);
};
export async function nativePairPrompt(prompt: string, approval: PairApproval, signal: AbortSignal): Promise<boolean> {
  const value = await runPrompt(prompt, ['--pair', approval.descriptor.recipient, approval.receiverFingerprint,
    approval.descriptorFingerprint, approval.descriptor.relay, new Date(approval.expiresAt).toISOString(),
    approval.macFingerprint, new Date(approval.descriptor.expiresAt).toISOString()], signal);
  if (value === null) return false;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 0) throw new SecretFailure('invalid_prompt_response');
  return true;
}
export async function nativeCodePairPrompt(prompt: string, recipient: string, relay: string, expiry: number, verification: string, signal: AbortSignal): Promise<boolean> {
  const response = await runPrompt(prompt, ['--pair-code', recipient, relay, new Date(expiry).toISOString()], signal);
  if (response === null) return false;
  const value = response as Record<string, unknown>;
  if (Object.keys(value).length !== 1 || value.VERIFICATION_CODE !== verification) throw new SecretFailure('pairing_peer_mismatch');
  return true;
}
async function runPrompt(executable: string, args: string[], signal: AbortSignal): Promise<unknown | null> {
  const child = spawn(executable, args, { shell: false, stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
    env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' } });
  const pipe = child.stdio[3];
  if (!pipe || !('on' in pipe)) { child.kill('SIGKILL'); throw new SecretFailure('prompt_unavailable'); }
  return new Promise((accept, reject) => {
    const chunks: Buffer[] = []; let size = 0; let failure: SecretFailure | undefined;
    const cancel = () => { failure ??= new SecretFailure('request_cancelled'); child.kill('SIGKILL'); };
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel();
    child.once('error', () => { failure ??= new SecretFailure('prompt_unavailable'); });
    pipe.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > SECRET_PROMPT_LIMIT) { failure ??= new SecretFailure('invalid_prompt_response'); child.kill('SIGKILL'); }
      else chunks.push(chunk);
    });
    pipe.on('error', () => { failure ??= new SecretFailure('prompt_unavailable'); child.kill('SIGKILL'); });
    child.once('close', (code) => {
      signal.removeEventListener('abort', cancel);
      try {
        if (failure) throw failure;
        if (code !== 0) throw new SecretFailure('prompt_unavailable');
        const response = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (response.cancelled === true) accept(null);
        else if (response.cancelled === false) accept(response.values);
        else throw new SecretFailure('invalid_prompt_response');
      } catch (error) { reject(error instanceof SecretFailure ? error : new SecretFailure('invalid_prompt_response')); }
      finally { for (const chunk of chunks) chunk.fill(0); }
    });
  });
}
