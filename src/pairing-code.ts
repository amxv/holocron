import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import nacl from 'tweetnacl';
import { readPrivateConfig } from './private-state.ts';
import { decode, encode, tokenHash } from './secret-crypto.ts';
import { completeReceiver, macFingerprint, pairDescriptor, prepareReceiver, receiverFingerprint, writePairingJson } from './secret-enrollment.ts';
import { relayClient, waitSecret } from './secret-client.ts';
import type { RelayCall } from './secret-client.ts';
import { relayUrl, promptExecutable } from './secret-pairing.ts';
import { SecretFailure, encoded } from './secret-shapes.ts';
import { nativeCodePairPrompt } from './secret-prompt.ts';
import { CODE_MS, checkMacReveal, cleanCode, commitmentCode, displayCode, freshNonce, offerCommitment,
  parseMacReveal, parseOffer, parseReceiverCommit, parseReceiverReveal, receiverCommitment, verificationCode } from './pairing-code-wire.ts';
import type { CodeOffer } from './pairing-code-wire.ts';

const acknowledged = (r: Record<string, unknown>) => { if (r.ok !== true) throw new SecretFailure('invalid_relay_response'); };
function transport(relay: string, code: string, token: string): RelayCall {
  return relayClient({ relay, token, channel: { channel: code } } as Parameters<typeof relayClient>[0]);
}
async function poll(call: RelayCall, state: string, signal: AbortSignal, interval: number) {
  for (;;) {
    if (signal.aborted) throw new SecretFailure('pairing_cancelled_or_expired');
    const result = await call('code-poll', {}, signal);
    if (result.state === state) return result;
    if (['cancelled', 'consumed', 'delivered'].includes(String(result.state))) throw new SecretFailure('pairing_code_used');
    await waitSecret(signal, interval);
  }
}
export async function offerPairing(options: { directory: string; relay: string; prompt: string; adminFile: string }, signal: AbortSignal,
  dependencies: { call?: (code: string, token: string) => RelayCall; interval?: number;
    output: (line: string) => void; approve?: (verification: string, recipient: string, signal: AbortSignal) => Promise<boolean>;
    provision?: NonNullable<Parameters<typeof pairDescriptor>[2]>['provision'] } ) {
  relayUrl(options.relay); await promptExecutable(options.prompt);
  const admin = (await readPrivateConfig(options.adminFile)).toString('utf8').trim(); encoded(admin, 32);
  const key = nacl.box.keyPair(); const token = freshNonce();
  const mac = { nonce: freshNonce(), macBoxPublic: encode(key.publicKey) };
  const expiresAt = Date.now() + CODE_MS;
  const commitment = offerCommitment(options.relay, expiresAt, mac);
  const offer: CodeOffer = { version: 1, code: commitmentCode(commitment), commitment, expiresAt };
  const call = (dependencies.call ?? ((c, t) => transport(options.relay, c, t)))(offer.code, token);
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, expiresAt - Date.now()))]); let opened = false; let paired: string | undefined;
  try {
    acknowledged(await (dependencies.call ?? ((c, t) => transport(options.relay, c, t)))(offer.code, admin)('code-open', { offer, ownerTokenHash: tokenHash(token) }, deadline));
    opened = true; dependencies.output(`Pairing code: ${displayCode(offer.code)} (expires in fifteen minutes)`);
    const reply = await poll(call, 'committed', deadline, dependencies.interval ?? 1000);
    const receiver = parseReceiverCommit(reply.commit); // Freeze locally BEFORE revealing the Mac key.
    acknowledged(await call('code-reveal-mac', mac, deadline));
    const next = await poll(call, 'receiver-revealed', deadline, dependencies.interval ?? 1000);
    const reveal = parseReceiverReveal(next.reveal);
    if (receiverCommitment(offer, reveal) !== receiver.commitment || reveal.descriptor.relay !== options.relay) throw new SecretFailure('pairing_peer_mismatch');
    const verification = verificationCode(offer, mac, reveal, key.secretKey, 'mac');
    const result = await pairDescriptor({ ...options, descriptor: reveal.descriptor, receiverFingerprint: receiverFingerprint(reveal.descriptor) }, deadline, {
      key,
      ...(dependencies.provision ? { provision: dependencies.provision } : {}),
      approve: async (_prompt, approval, pending) => {
        const close = new AbortController(); const promptSignal = AbortSignal.any([pending, close.signal]);
        let failure: unknown;
        const monitor = (async () => {
          try {
            while (!promptSignal.aborted) {
              await waitSecret(promptSignal, dependencies.interval ?? 1000);
              const status = await call('code-poll', {}, promptSignal);
              if (status.state !== 'receiver-revealed' || receiverCommitment(offer, parseReceiverReveal(status.reveal)) !== receiver.commitment) throw new SecretFailure('pairing_cancelled');
            }
          } catch (error) { if (!promptSignal.aborted) { failure = error; close.abort(); } }
        })();
        let accepted: boolean;
        try { accepted = await (dependencies.approve ?? ((v, recipient, s) => nativeCodePairPrompt(options.prompt, recipient, options.relay, expiresAt, v, s)))(verification, approval.descriptor.recipient, promptSignal); }
        finally { close.abort(); await monitor; }
        if (failure) throw failure;
        if (!accepted || pending.aborted) return false;
        // A backend loss/cancellation during the prompt must prevent provisioning.
        const status = await call('code-poll', {}, pending);
        if (status.state !== 'receiver-revealed' || receiverCommitment(offer, parseReceiverReveal(status.reveal)) !== receiver.commitment) throw new SecretFailure('pairing_cancelled');
        return true;
      },
    });
    paired = result.macConfig;
    acknowledged(await call('code-deliver', JSON.parse(await readFile(result.enrollmentFile, 'utf8')), deadline));
    await rm(result.enrollmentFile);
    dependencies.output('Pairing approved. Receiver completes locally.');
    return result.macConfig;
  } catch (error) {
    if (paired) throw new SecretFailure('pairing_incomplete_revoke_mac_config');
    throw error;
  } finally {
    key.secretKey.fill(0);
    if (opened && !paired) await call('code-cancel', {}, AbortSignal.timeout(5000)).catch(() => {});
  }
}
export async function receivePairing(options: { directory: string; relay: string; recipient: string; code: string }, signal: AbortSignal,
  dependencies: { call?: (code: string, token: string) => RelayCall; interval?: number; output: (line: string) => void }) {
  relayUrl(options.relay); const code = cleanCode(options.code); const token = freshNonce();
  const call = (dependencies.call ?? ((c, t) => transport(options.relay, c, t)))(code, token);
  const offer = parseOffer((await call('code-peek', {}, signal)).offer, code);
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, offer.expiresAt - Date.now()))]);
  const prepared = await prepareReceiver(options.directory, options.relay, options.recipient);
  let committed = false; let completed = false;
  try {
    const pending = JSON.parse((await readPrivateConfig(prepared.pendingFile)).toString('utf8'));
    const reveal = { nonce: freshNonce(), descriptor: pending.descriptor };
    acknowledged(await call('code-commit', { commitment: receiverCommitment(offer, reveal), receiverTokenHash: tokenHash(token) }, deadline));
    committed = true;
    const next = await poll(call, 'mac-revealed', deadline, dependencies.interval ?? 1000);
    const mac = parseMacReveal(next.mac); checkMacReveal(offer, options.relay, mac);
    const secret = decode(pending.enrollmentSecret);
    let verification: string;
    try { verification = verificationCode(offer, mac, reveal, secret, 'receiver'); } finally { secret.fill(0); }
    acknowledged(await call('code-reveal-receiver', reveal, deadline));
    dependencies.output(`Verification number: ${verification}. Give this number to the Mac owner through your trusted conversation; enter it only in the native pairing prompt.`);
    const delivered = await poll(call, 'delivered', deadline, dependencies.interval ?? 1000);
    const enrollmentFile = join(options.directory, 'enrollment.json');
    await writePairingJson(enrollmentFile, delivered.enrollment);
    const result = await completeReceiver(prepared.pendingFile, enrollmentFile, macFingerprint(mac.macBoxPublic));
    completed = true; await rm(enrollmentFile); await rm(prepared.descriptorFile);
    return result.receiverConfig;
  } finally {
    if (!completed) {
      if (committed) await call('code-cancel', {}, AbortSignal.timeout(5000)).catch(() => {});
      await rm(options.directory, { recursive: true, force: true });
    }
  }
}
