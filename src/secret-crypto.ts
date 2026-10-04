import nacl from 'tweetnacl';
import { createHash } from 'node:crypto';
import { SecretFailure, SECRET_VALUE_LIMIT, parseEnvelope } from './secret-shapes.ts';
import type { SecretEnvelope, SecretRequest } from './secret-shapes.ts';

export const encode = (value: Uint8Array) => Buffer.from(value).toString('base64url');
export const decode = (value: string) => new Uint8Array(Buffer.from(value, 'base64url'));
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const fingerprint = (publicKey: string) => tokenHash(publicKey).slice(0, 24);
// Array order and domain separation are fixed; JSON property order is never an authentication input.
export function requestBytes(r: Omit<SecretRequest, 'signature'> | SecretRequest): Uint8Array {
  return Buffer.from(JSON.stringify(['board-secret-request-v1', r.channel, r.id, r.expiresAt, r.names, r.purpose, r.receiverPublic]));
}
export function signRequest(r: Omit<SecretRequest, 'signature'>, key: string): SecretRequest {
  return { ...r, signature: encode(nacl.sign.detached(requestBytes(r), decode(key))) };
}
export function verifyRequest(r: SecretRequest, publicKey: string): void {
  if (!nacl.sign.detached.verify(requestBytes(r), decode(r.signature), decode(publicKey))) throw new SecretFailure('request_authentication_failed');
}
export function secretValues(value: unknown, requested: string[]): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== requested.length ||
      Object.keys(value).some((name) => !requested.includes(name))) throw new SecretFailure('invalid_prompt_response');
  for (const name of requested) {
    const text = (value as Record<string, unknown>)[name];
    if (typeof text !== 'string' || text.length === 0 || Buffer.byteLength(text) > SECRET_VALUE_LIMIT || text.includes('\0') ||
        Buffer.from(text).toString('utf8') !== text) {
      throw new SecretFailure('invalid_prompt_response');
    }
  }
  return value as Record<string, string>;
}
export function encryptSecrets(r: SecretRequest, values: unknown, macSecret: string): SecretEnvelope {
  const shared = nacl.scalarMult(decode(macSecret), decode(r.receiverPublic));
  const invalid = shared.every((byte) => byte === 0); shared.fill(0);
  if (invalid) throw new SecretFailure('invalid_recipient_key');
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const exact = secretValues(values, r.names);
  const encodedValues = Object.fromEntries(Object.entries(exact).map(([name, text]) => [name, Buffer.from(text).toString('base64url')]));
  const plaintext = Buffer.from(JSON.stringify({ request: encode(requestBytes(r)), values: encodedValues }));
  try {
    return { nonce: encode(nonce), ciphertext: encode(nacl.box(plaintext, nonce, decode(r.receiverPublic), decode(macSecret))) };
  } finally { plaintext.fill(0); }
}
export function decryptSecrets(r: SecretRequest, envelope: SecretEnvelope, receiverSecret: Uint8Array, macPublic: string): Record<string, string> {
  parseEnvelope(envelope);
  const plaintext = nacl.box.open(decode(envelope.ciphertext), decode(envelope.nonce), decode(macPublic), receiverSecret);
  if (!plaintext) throw new SecretFailure('delivery_authentication_failed');
  try {
    const parsed = JSON.parse(Buffer.from(plaintext).toString('utf8'));
    if (parsed.request !== encode(requestBytes(r))) throw new SecretFailure('delivery_request_mismatch');
    if (!parsed.values || typeof parsed.values !== 'object' || Array.isArray(parsed.values)) throw new SecretFailure('invalid_delivery');
    const values = Object.fromEntries(Object.entries(parsed.values).map(([name, value]) => {
      if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new SecretFailure('invalid_delivery');
      const bytes = Buffer.from(value, 'base64url');
      if (bytes.toString('base64url') !== value) throw new SecretFailure('invalid_delivery');
      return [name, new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)];
    }));
    return secretValues(values, r.names);
  } catch (error) { throw error instanceof SecretFailure ? error : new SecretFailure('invalid_delivery'); }
  finally { plaintext.fill(0); }
}
