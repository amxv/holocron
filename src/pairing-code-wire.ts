import { createHash, hkdfSync } from 'node:crypto';
import nacl from 'tweetnacl';
import { decode, encode } from './secret-crypto.ts';
import { descriptorFingerprint, parseDescriptor } from './secret-enrollment.ts';
import type { ReceiverDescriptor } from './secret-enrollment.ts';
import { encoded, hashPattern, object, SecretFailure, PAIRING_CODE_MS } from './secret-shapes.ts';

export const CODE_MS = PAIRING_CODE_MS;
export const codePattern = /^[A-Z2-7]{20}$/;
export const cleanCode = (code: string) => code.toUpperCase().replaceAll('-', '');
export const displayCode = (code: string) => code.match(/.{4}/g)!.join('-');
export interface CodeOffer { version: 1; code: string; commitment: string; expiresAt: number }
export interface MacReveal { nonce: string; macBoxPublic: string }
export interface ReceiverCommit { commitment: string; receiverTokenHash: string }
export interface ReceiverReveal { nonce: string; descriptor: ReceiverDescriptor }
const hash = (parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
export const offerCommitment = (relay: string, expiresAt: number, reveal: MacReveal) =>
  hash(['holocron-code-mac-v1', relay, expiresAt, reveal.nonce, reveal.macBoxPublic]);
export function commitmentCode(commitment: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes = Buffer.from(commitment, 'hex'); let bits = 0; let value = 0; let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5 && output.length < 20) { bits -= 5; output += alphabet[(value >>> bits) & 31]; }
    if (output.length === 20) break;
  }
  return output;
}
export function parseOffer(value: unknown, code: string, now = Date.now()): CodeOffer {
  const v = object(value, ['version', 'code', 'commitment', 'expiresAt']);
  if (v.version !== 1 || !codePattern.test(code) || v.code !== code || typeof v.commitment !== 'string' ||
      !hashPattern.test(v.commitment) || commitmentCode(v.commitment) !== code ||
      !Number.isSafeInteger(v.expiresAt) || Number(v.expiresAt) <= now || Number(v.expiresAt) > now + CODE_MS) {
    throw new SecretFailure('pairing_code_expired_or_invalid');
  }
  return v as unknown as CodeOffer;
}
export function parseMacReveal(value: unknown): MacReveal {
  const v = object(value, ['nonce', 'macBoxPublic']); encoded(v.nonce, 32); encoded(v.macBoxPublic, 32);
  return v as unknown as MacReveal;
}
export function parseReceiverCommit(value: unknown): ReceiverCommit {
  const v = object(value, ['commitment', 'receiverTokenHash']);
  if (typeof v.commitment !== 'string' || !hashPattern.test(v.commitment) ||
      typeof v.receiverTokenHash !== 'string' || !hashPattern.test(v.receiverTokenHash)) throw new SecretFailure('invalid_pairing_code_message');
  return v as unknown as ReceiverCommit;
}
export function parseReceiverReveal(value: unknown): ReceiverReveal {
  const v = object(value, ['nonce', 'descriptor']); encoded(v.nonce, 32);
  return { nonce: v.nonce, descriptor: parseDescriptor(v.descriptor) };
}
export const receiverCommitment = (offer: CodeOffer, reveal: ReceiverReveal) =>
  hash(['holocron-code-receiver-v1', offer.code, offer.commitment, descriptorFingerprint(reveal.descriptor), reveal.nonce]);
export function verificationCode(offer: CodeOffer, mac: MacReveal, receiver: ReceiverReveal, secret: Uint8Array, role: 'mac' | 'receiver'): string {
  const shared = nacl.scalarMult(secret, decode(role === 'mac' ? receiver.descriptor.enrollmentPublic : mac.macBoxPublic));
  try {
    if (shared.every(byte => byte === 0)) throw new SecretFailure('invalid_recipient_key');
    const transcript = hash(['holocron-code-transcript-v1', offer.code, offer.commitment, offer.expiresAt,
      mac.nonce, mac.macBoxPublic, receiverCommitment(offer, receiver)]);
    const key = Buffer.from(hkdfSync('sha256', shared, Buffer.from(transcript, 'hex'), 'holocron-code-verification-v1', 8));
    try { return (key.readBigUInt64BE() % 100_000_000n).toString().padStart(8, '0'); }
    finally { key.fill(0); }
  } finally { shared.fill(0); }
}
export function checkMacReveal(offer: CodeOffer, relay: string, reveal: MacReveal): void {
  if (offerCommitment(relay, offer.expiresAt, reveal) !== offer.commitment) throw new SecretFailure('pairing_peer_mismatch');
}
export const freshNonce = () => encode(nacl.randomBytes(32));
