import nacl from 'tweetnacl';
import { encryptSecrets, decryptSecrets, signRequest, verifyRequest, encode } from './secret-crypto.ts';
import { parseSecretRequest, SECRET_REQUEST_MS, SecretFailure, names, label } from './secret-shapes.ts';
import type { SecretEnvelope, SecretRequest } from './secret-shapes.ts';
import type { SecretPairing } from './secret-pairing.ts';
import { relayClient, waitSecret } from './secret-client.ts';
import type { RelayCall } from './secret-client.ts';
import { nativeSecretPrompt } from './secret-prompt.ts';
import type { SecretPrompt } from './secret-prompt.ts';
import { writeSecretFiles } from './secret-files.ts';

export async function askSecrets(pairing: SecretPairing, requested: string[], purpose: string, signal: AbortSignal,
  options: { call?: RelayCall; write?: typeof writeSecretFiles; interval?: number } = {}): Promise<string> {
  names(requested); label(purpose);
  const call = options.call ?? relayClient(pairing); const receiver = nacl.box.keyPair();
  const request = signRequest({ version: 1, channel: pairing.channel.channel, id: Buffer.from(nacl.randomBytes(16)).toString('hex'),
    expiresAt: Math.min(Date.now() + SECRET_REQUEST_MS, pairing.channel.expiresAt), names: requested, purpose, receiverPublic: encode(receiver.publicKey) }, pairing.signSecret!);
  const pending = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, request.expiresAt - Date.now()))]);
  let created = false;
  try {
    created = true; await call('create', request, pending);
    for (;;) {
      const reply = await call('receive', { id: request.id }, pending);
      if (reply.state === 'delivered') {
        if (pending.aborted) throw new SecretFailure('request_cancelled');
        const values = decryptSecrets(request, reply.envelope as SecretEnvelope, receiver.secretKey, pairing.channel.macBoxPublic);
        if (pending.aborted) throw new SecretFailure('request_cancelled');
        return await (options.write ?? writeSecretFiles)(values, { signal: pending });
      }
      if (reply.state === 'cancelled' || reply.state === 'consumed') throw new SecretFailure('request_cancelled');
      if (reply.state !== 'pending' && reply.state !== 'claimed') throw new SecretFailure('invalid_relay_response');
      await waitSecret(pending, options.interval ?? 1000);
    }
  } finally {
    receiver.secretKey.fill(0);
    if (created) await call('cancel', { id: request.id }).catch(() => {});
  }
}

async function handleRequest(pairing: SecretPairing, request: SecretRequest, call: RelayCall, parent: AbortSignal, prompt: SecretPrompt, interval: number): Promise<void> {
  verifyRequest(request, pairing.channel.receiverSignPublic);
  if (request.channel !== pairing.channel.channel || request.expiresAt > pairing.channel.expiresAt) throw new SecretFailure('invalid_request');
  const stopped = new AbortController();
  let monitorFailed = false;
  const pending = AbortSignal.any([parent, stopped.signal, AbortSignal.timeout(Math.max(1, request.expiresAt - Date.now()))]);
  // A receiver cancellation closes the human prompt while it is still open.
  const monitor = (async () => {
    try {
      while (!pending.aborted) {
        await waitSecret(pending, interval);
        const state = await call('status', { id: request.id }, pending);
        if (['cancelled', 'consumed', 'delivered'].includes(String(state.state))) { stopped.abort(); return; }
        if (state.state !== 'claimed') throw new SecretFailure('invalid_relay_response');
      }
    } catch { monitorFailed = !pending.aborted; stopped.abort(); }
  })();
  try {
    const values = await prompt(pairing, request, pending);
    if (values === null || pending.aborted) throw new SecretFailure('request_cancelled');
    const envelope = encryptSecrets(request, values, pairing.boxSecret!);
    if (pending.aborted) throw new SecretFailure('request_cancelled');
    await call('deliver', { id: request.id, envelope }, pending);
  } catch (error) {
    if (monitorFailed && !parent.aborted) throw new SecretFailure('relay_unavailable');
    throw error;
  } finally { stopped.abort(); await monitor; }
}

export async function serveSecrets(pairing: SecretPairing, signal: AbortSignal, options: {
  call?: RelayCall; prompt?: SecretPrompt; idleInterval?: number; activeInterval?: number;
} = {}): Promise<void> {
  const call = options.call ?? relayClient(pairing);
  while (!signal.aborted) {
    if (Date.now() >= pairing.channel.expiresAt) throw new SecretFailure('pairing_expired');
    const reply = await call('claim', {}, signal);
    if (reply.request !== null) {
      let request: SecretRequest | undefined;
      try {
        request = parseSecretRequest(reply.request, Date.now());
        await handleRequest(pairing, request, call, signal, options.prompt ?? nativeSecretPrompt, options.activeInterval ?? 2000);
      } catch (error) {
        if (request) await call('cancel', { id: request.id }).catch(() => {});
        if (signal.aborted) return;
        // Fail closed on forged requests, transport loss or helper failures. No automatic retry prompt.
        if (!(error instanceof SecretFailure && error.code === 'request_cancelled')) throw new SecretFailure('secret_request_failed');
      }
    }
    await waitSecret(signal, options.idleInterval ?? 30_000).catch((error) => { if (!signal.aborted) throw error; });
  }
}
