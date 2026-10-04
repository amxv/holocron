import { constants } from 'node:fs';
import { mkdir, open, realpath, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import nacl from 'tweetnacl';
import { privateDirectory, readPrivateConfig } from './private-state.ts';
import { encode, decode, tokenHash } from './secret-crypto.ts';
import { encoded, hashPattern, idPattern, label, object, PAIRING_MS, parseChannel, parseEnvelope, SecretFailure } from './secret-shapes.ts';
import type { SecretEnvelope } from './secret-shapes.ts';
import { promptExecutable, relayUrl } from './secret-pairing.ts';
import type { SecretPairing } from './secret-pairing.ts';
import { relayClient } from './secret-client.ts';
import { nativePairPrompt } from './secret-prompt.ts';

export const ENROLLMENT_MS = 15 * 60_000;
export interface ReceiverDescriptor {
  version: 1; relay: string; channel: string; expiresAt: number; recipient: string;
  receiverSignPublic: string; enrollmentPublic: string; receiverTokenHash: string; signature: string;
}
function descriptorBytes(d: Omit<ReceiverDescriptor, 'signature'>): Uint8Array {
  return Buffer.from(JSON.stringify(['holocron-enrollment-request-v1', d.relay, d.channel, d.expiresAt,
    d.recipient, d.receiverSignPublic, d.enrollmentPublic, d.receiverTokenHash]));
}
export const descriptorFingerprint = (d: ReceiverDescriptor) => tokenHash(encode(descriptorBytes(d)));
export const receiverFingerprint = (d: ReceiverDescriptor) => tokenHash(d.receiverSignPublic);
export const macFingerprint = (publicKey: string) => tokenHash(publicKey);
export function parseDescriptor(value: unknown): ReceiverDescriptor {
  const d = object(value, ['version', 'relay', 'channel', 'expiresAt', 'recipient', 'receiverSignPublic', 'enrollmentPublic', 'receiverTokenHash', 'signature']);
  if (d.version !== 1 || typeof d.relay !== 'string' || typeof d.channel !== 'string' || !idPattern.test(d.channel) ||
      !Number.isSafeInteger(d.expiresAt) || Number(d.expiresAt) <= Date.now() || Number(d.expiresAt) > Date.now() + ENROLLMENT_MS ||
      typeof d.receiverTokenHash !== 'string' || !hashPattern.test(d.receiverTokenHash)) throw new SecretFailure('invalid_enrollment');
  relayUrl(d.relay); label(d.recipient, 64); encoded(d.receiverSignPublic, 32); encoded(d.enrollmentPublic, 32); encoded(d.signature, 64);
  const descriptor = d as unknown as ReceiverDescriptor;
  if (!nacl.sign.detached.verify(descriptorBytes(descriptor), decode(descriptor.signature), decode(descriptor.receiverSignPublic))) {
    throw new SecretFailure('enrollment_authentication_failed');
  }
  return descriptor;
}
async function readJson(path: string): Promise<unknown> {
  // Public exchange files are staged privately to prevent local replacement/symlink attacks.
  return JSON.parse((await readPrivateConfig(path)).toString('utf8'));
}
async function newDirectory(directory: string): Promise<void> {
  if (!isAbsolute(directory) || resolve(directory) !== directory || await realpath(dirname(directory)) !== dirname(directory)) {
    throw new SecretFailure('unsafe_pairing_directory');
  }
  await privateDirectory(dirname(directory));
  await mkdir(directory, { mode: 0o700 }); // Never adopt or overwrite another pairing.
}
export async function writePairingJson(path: string, value: unknown): Promise<void> {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync(); }
  catch (error) { await rm(path, { force: true }); throw error; }
  finally { await handle.close(); }
}
const writeJson = writePairingJson;
export async function prepareReceiver(directory: string, relay: string, recipient: string) {
  relayUrl(relay); label(recipient, 64);
  await newDirectory(directory);
  const signing = nacl.sign.keyPair(); const enrollment = nacl.box.keyPair();
  try {
    const token = encode(nacl.randomBytes(32));
    const unsigned = { version: 1 as const, relay, channel: Buffer.from(nacl.randomBytes(16)).toString('hex'),
      expiresAt: Date.now() + ENROLLMENT_MS, recipient, receiverSignPublic: encode(signing.publicKey),
      enrollmentPublic: encode(enrollment.publicKey), receiverTokenHash: tokenHash(token) };
    const descriptor: ReceiverDescriptor = { ...unsigned, signature: encode(nacl.sign.detached(descriptorBytes(unsigned), signing.secretKey)) };
    const pendingFile = join(directory, 'pending.json'); const descriptorFile = join(directory, 'descriptor.json');
    await writeJson(pendingFile, { version: 1, role: 'receiver-pending', descriptor, token,
      signSecret: encode(signing.secretKey), enrollmentSecret: encode(enrollment.secretKey) });
    await writeJson(descriptorFile, descriptor);
    return { pendingFile, descriptorFile, receiverFingerprint: receiverFingerprint(descriptor), descriptorFingerprint: descriptorFingerprint(descriptor) };
  } catch (error) { await rm(directory, { recursive: true }); throw error; }
  finally { signing.secretKey.fill(0); enrollment.secretKey.fill(0); }
}
export interface PairApproval {
  descriptor: ReceiverDescriptor; receiverFingerprint: string; descriptorFingerprint: string; macFingerprint: string; expiresAt: number;
}
export async function pairReceiver(options: {
  directory: string; descriptorFile: string; receiverFingerprint: string; prompt: string; adminFile: string;
}, signal: AbortSignal, dependencies: {
  approve?: (prompt: string, approval: PairApproval, signal: AbortSignal) => Promise<boolean>;
  provision?: (pairing: SecretPairing, admin: string, signal: AbortSignal) => Promise<{ ok?: unknown }>;
} = {}) {
  const descriptor = parseDescriptor(await readJson(options.descriptorFile));
  return pairDescriptor({ ...options, descriptor }, signal, dependencies);
}
export async function pairDescriptor(options: {
  directory: string; descriptor: ReceiverDescriptor; receiverFingerprint: string; prompt: string; adminFile: string;
}, signal: AbortSignal, dependencies: {
  approve?: (prompt: string, approval: PairApproval, signal: AbortSignal) => Promise<boolean>;
  provision?: (pairing: SecretPairing, admin: string, signal: AbortSignal) => Promise<{ ok?: unknown }>;
  key?: nacl.BoxKeyPair;
} = {}) {
  const descriptor = parseDescriptor(options.descriptor);
  if (!hashPattern.test(options.receiverFingerprint) || options.receiverFingerprint !== receiverFingerprint(descriptor)) {
    throw new SecretFailure('receiver_fingerprint_mismatch');
  }
  await promptExecutable(options.prompt);
  const admin = (await readPrivateConfig(options.adminFile)).toString('utf8').trim(); encoded(admin, 32);
  await newDirectory(options.directory);
  const key = dependencies.key ?? nacl.box.keyPair(); let provisioning = false;
  const pending = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, descriptor.expiresAt - Date.now()))]);
  try {
    const macBoxPublic = encode(key.publicKey); const expiry = Date.now() + PAIRING_MS;
    const approval: PairApproval = { descriptor, receiverFingerprint: receiverFingerprint(descriptor),
      descriptorFingerprint: descriptorFingerprint(descriptor), macFingerprint: macFingerprint(macBoxPublic), expiresAt: expiry };
    const approved = await (dependencies.approve ?? nativePairPrompt)(options.prompt, approval, pending);
    if (!approved || pending.aborted) throw new SecretFailure('pairing_cancelled');
    parseDescriptor(descriptor); // Approval cannot extend an expired enrollment.
    const token = encode(nacl.randomBytes(32));
    const channel = { version: 1 as const, channel: descriptor.channel, expiresAt: expiry, recipient: descriptor.recipient,
      macTokenHash: tokenHash(token), receiverTokenHash: descriptor.receiverTokenHash,
      receiverSignPublic: descriptor.receiverSignPublic, macBoxPublic };
    const pairing: SecretPairing = { version: 1, role: 'mac', relay: descriptor.relay, channel, token, boxSecret: encode(key.secretKey), prompt: options.prompt };
    const shared = nacl.scalarMult(key.secretKey, decode(descriptor.enrollmentPublic));
    const invalid = shared.every((byte) => byte === 0); shared.fill(0);
    if (invalid) throw new SecretFailure('invalid_recipient_key');
    const plaintext = Buffer.from(JSON.stringify({ context: 'holocron-enrollment-response-v1',
      descriptorFingerprint: approval.descriptorFingerprint, relay: pairing.relay, channel }));
    let envelope: SecretEnvelope;
    try {
      const nonce = nacl.randomBytes(24);
      envelope = { nonce: encode(nonce), ciphertext: encode(nacl.box(plaintext, nonce, decode(descriptor.enrollmentPublic), key.secretKey)) };
    } finally { plaintext.fill(0); }
    const macConfig = join(options.directory, 'mac.json'); const enrollmentFile = join(options.directory, 'enrollment.json');
    await writeJson(macConfig, pairing);
    provisioning = true; // An uncertain network write must retain the Mac credential for revocation.
    const result = await (dependencies.provision ?? (async (p, a, s) => relayClient({ ...p, token: a })('provision', p.channel, s)))(pairing, admin, pending);
    if (result.ok !== true) throw new SecretFailure('invalid_relay_response');
    if (pending.aborted) throw new SecretFailure('pairing_cancelled');
    await writeJson(enrollmentFile, { version: 1, descriptorFingerprint: approval.descriptorFingerprint, macBoxPublic, envelope });
    return { macConfig, enrollmentFile, receiverFingerprint: approval.receiverFingerprint,
      descriptorFingerprint: approval.descriptorFingerprint, macFingerprint: approval.macFingerprint };
  } catch (error) {
    if (!provisioning) await rm(options.directory, { recursive: true });
    else throw new SecretFailure('pairing_incomplete_revoke_mac_config');
    throw error;
  } finally { key.secretKey.fill(0); }
}
export async function completeReceiver(pendingFile: string, enrollmentFile: string, expectedMacFingerprint: string) {
  if (!hashPattern.test(expectedMacFingerprint)) throw new SecretFailure('invalid_mac_fingerprint');
  const p = object(await readJson(pendingFile), ['version', 'role', 'descriptor', 'token', 'signSecret', 'enrollmentSecret']);
  if (p.version !== 1 || p.role !== 'receiver-pending') throw new SecretFailure('invalid_enrollment');
  const descriptor = parseDescriptor(p.descriptor);
  encoded(p.token, 32); encoded(p.signSecret, 64); encoded(p.enrollmentSecret, 32);
  if (tokenHash(p.token) !== descriptor.receiverTokenHash ||
      encode(nacl.sign.keyPair.fromSecretKey(decode(p.signSecret)).publicKey) !== descriptor.receiverSignPublic ||
      encode(nacl.box.keyPair.fromSecretKey(decode(p.enrollmentSecret)).publicKey) !== descriptor.enrollmentPublic) throw new SecretFailure('invalid_enrollment');
  const value = object(await readJson(enrollmentFile), ['version', 'descriptorFingerprint', 'macBoxPublic', 'envelope']);
  encoded(value.macBoxPublic, 32); const envelope = parseEnvelope(value.envelope);
  if (value.version !== 1 || value.descriptorFingerprint !== descriptorFingerprint(descriptor)) throw new SecretFailure('enrollment_request_mismatch');
  if (macFingerprint(value.macBoxPublic) !== expectedMacFingerprint) throw new SecretFailure('mac_fingerprint_mismatch');
  const secret = decode(p.enrollmentSecret);
  const plaintext = nacl.box.open(decode(envelope.ciphertext), decode(envelope.nonce), decode(value.macBoxPublic), secret);
  secret.fill(0);
  if (!plaintext) throw new SecretFailure('enrollment_authentication_failed');
  try {
    const response = object(JSON.parse(Buffer.from(plaintext).toString('utf8')), ['context', 'descriptorFingerprint', 'relay', 'channel']);
    if (response.context !== 'holocron-enrollment-response-v1' || response.descriptorFingerprint !== descriptorFingerprint(descriptor) ||
        response.relay !== descriptor.relay) throw new SecretFailure('enrollment_request_mismatch');
    const channel = parseChannel(response.channel, Date.now());
    if (channel.channel !== descriptor.channel || channel.recipient !== descriptor.recipient ||
        channel.receiverSignPublic !== descriptor.receiverSignPublic || channel.receiverTokenHash !== descriptor.receiverTokenHash ||
        channel.macBoxPublic !== value.macBoxPublic) throw new SecretFailure('enrollment_request_mismatch');
    const pairing: SecretPairing = { version: 1, role: 'receiver', relay: descriptor.relay, channel, token: p.token, signSecret: p.signSecret };
    const receiverConfig = join(dirname(pendingFile), 'receiver.json');
    await writeJson(receiverConfig, pairing); // Exclusive creation makes completion single-use, including concurrent processes.
    try { await rm(pendingFile); }
    catch { throw new SecretFailure('paired_pending_cleanup_failed'); }
    return { receiverConfig, receiverFingerprint: receiverFingerprint(descriptor), macFingerprint: expectedMacFingerprint, expiresAt: channel.expiresAt };
  } finally { plaintext.fill(0); }
}
