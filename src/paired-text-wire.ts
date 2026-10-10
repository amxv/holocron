import { createHash, randomBytes } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import nacl from 'tweetnacl';
import { decode, encode } from './secret-crypto.ts';
import type { SecretPairing } from './secret-pairing.ts';
import { idPattern, parseEnvelope, SecretFailure } from './secret-shapes.ts';
import type { SecretEnvelope } from './secret-shapes.ts';
import { safeName, validUtf8 } from './text.ts';

export const PAIRED_TEXT_LIMIT = 16 * 1024;
export const PAIRED_TEXT_TTL_MS = 24 * 60 * 60 * 1000;

// Old pairings already carry a Mac X25519 key and a receiver Ed25519 key.
// Noble's standard Ed25519 -> X25519 conversion enables authenticated boxes
// in either direction without distributing new credentials or re-pairing.
function keys(pair: SecretPairing): { secret: Uint8Array; peer: Uint8Array } {
  if (pair.role === 'mac') return {
    secret: decode(pair.boxSecret!), peer: ed25519.utils.toMontgomery(decode(pair.channel.receiverSignPublic)),
  };
  const signing = decode(pair.signSecret!);
  try { return { secret: ed25519.utils.toMontgomerySecret(signing.subarray(0, 32)), peer: decode(pair.channel.macBoxPublic) }; }
  finally { signing.fill(0); }
}

export function encodePairedText(pair: SecretPairing, id: string, name: string, text: string): SecretEnvelope {
  if (!idPattern.test(id)) throw new SecretFailure('invalid_message_id');
  safeName(name);
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.toString('utf8') !== text || bytes.byteLength > PAIRED_TEXT_LIMIT) throw new SecretFailure('invalid_text');
  const payload = Buffer.from(JSON.stringify(['holocron-paired-text-v1', pair.channel.channel, id,
    pair.role, name, bytes.toString('base64url')]), 'utf8');
  const nonce = randomBytes(nacl.box.nonceLength);
  const { secret, peer } = keys(pair);
  try { return { nonce: encode(nonce), ciphertext: encode(nacl.box(payload, nonce, peer, secret)) }; }
  finally { secret.fill(0); payload.fill(0); bytes.fill(0); }
}

export function decodePairedText(pair: SecretPairing, id: string, envelope: SecretEnvelope): { name: string; text: string; byteCount: number; sha256: string } {
  if (!idPattern.test(id)) throw new SecretFailure('invalid_message_id');
  parseEnvelope(envelope);
  const { secret, peer } = keys(pair);
  let payload: Uint8Array | null;
  try { payload = nacl.box.open(decode(envelope.ciphertext), decode(envelope.nonce), peer, secret); }
  finally { secret.fill(0); }
  if (!payload) throw new SecretFailure('message_authentication_failed');
  try {
    const parts: unknown = JSON.parse(Buffer.from(payload).toString('utf8'));
    if (!Array.isArray(parts) || parts.length !== 6 || parts[0] !== 'holocron-paired-text-v1' ||
        parts[1] !== pair.channel.channel || parts[2] !== id ||
        parts[3] !== (pair.role === 'mac' ? 'receiver' : 'mac') || typeof parts[4] !== 'string' ||
        typeof parts[5] !== 'string' || !/^[A-Za-z0-9_-]*$/.test(parts[5])) throw new Error('invalid_payload');
    safeName(parts[4]);
    const bytes = Buffer.from(parts[5], 'base64url');
    if (bytes.toString('base64url') !== parts[5]) throw new Error('invalid_payload');
    try { return { name: parts[4], text: validUtf8(bytes, PAIRED_TEXT_LIMIT), byteCount: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex') }; }
    finally { bytes.fill(0); }
  } catch { throw new SecretFailure('invalid_paired_text'); }
  finally { payload.fill(0); }
}
