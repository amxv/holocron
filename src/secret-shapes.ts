// Shared wire contract. These objects contain request metadata or ciphertext only.
export const SECRET_REQUEST_MS = 15 * 60_000;
export const PAIRING_CODE_MS = 15 * 60_000;
// Plaintext lifetime starts only after receipt, independently of human approval.
export const SECRET_FILE_MS = 300_000;
export const PAIRING_MS = 7 * 86_400_000;
export const SECRET_WIRE_LIMIT = 64 * 1024;
export const SECRET_PROMPT_LIMIT = 256 * 1024;
export const SECRET_VALUE_LIMIT = 4096;
export const PAIRED_TEXT_TTL_MS = 24 * 60 * 60 * 1000;
export class SecretFailure extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
export interface SecretRequest {
  version: 1; channel: string; id: string; expiresAt: number;
  names: string[]; purpose: string; receiverPublic: string; signature: string;
}
export interface SecretEnvelope { nonce: string; ciphertext: string }
export interface SecretChannel {
  version: 1; channel: string; expiresAt: number; recipient: string;
  macTokenHash: string; receiverTokenHash: string; receiverSignPublic: string; macBoxPublic: string;
}
export type SecretState = 'pending' | 'claimed' | 'delivered' | 'cancelled' | 'consumed';
export interface SecretDelivery { state: SecretState; request: SecretRequest; envelope?: SecretEnvelope }
export const idPattern = /^[a-f0-9]{32}$/;
export const hashPattern = /^[a-f0-9]{64}$/;
export function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))) throw new SecretFailure('invalid_arguments');
  return value as Record<string, unknown>;
}
export function label(value: unknown, maximum = 500): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum || Buffer.from(value).toString('utf8') !== value ||
      /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u.test(value)) {
    throw new SecretFailure('invalid_arguments');
  }
}
export function encoded(value: unknown, length?: number): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > SECRET_WIRE_LIMIT ||
      (length !== undefined && Buffer.from(value, 'base64url').length !== length) ||
      Buffer.from(value, 'base64url').toString('base64url') !== value) throw new SecretFailure('invalid_arguments');
}
export function names(value: unknown): asserts value is string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8 || new Set(value).size !== value.length ||
      value.some((name) => typeof name !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(name))) throw new SecretFailure('invalid_arguments');
}
export function parseSecretRequest(value: unknown, now: number, future = SECRET_REQUEST_MS): SecretRequest {
  const r = object(value, ['version', 'channel', 'id', 'expiresAt', 'names', 'purpose', 'receiverPublic', 'signature']);
  if (r.version !== 1 || typeof r.channel !== 'string' || !idPattern.test(r.channel) ||
      typeof r.id !== 'string' || !idPattern.test(r.id) || !Number.isSafeInteger(r.expiresAt) ||
      Number(r.expiresAt) <= now || Number(r.expiresAt) > now + future) throw new SecretFailure('request_expired_or_invalid');
  names(r.names); label(r.purpose); encoded(r.receiverPublic, 32); encoded(r.signature, 64);
  return r as unknown as SecretRequest;
}
export function parseEnvelope(value: unknown): SecretEnvelope {
  const e = object(value, ['nonce', 'ciphertext']); encoded(e.nonce, 24); encoded(e.ciphertext);
  const size = Buffer.from(e.ciphertext, 'base64url').length;
  if (size < 16 || size > 48_000) throw new SecretFailure('invalid_envelope');
  return e as unknown as SecretEnvelope;
}
export function parseChannel(value: unknown, now: number): SecretChannel {
  const c = object(value, ['version', 'channel', 'expiresAt', 'recipient', 'macTokenHash', 'receiverTokenHash', 'receiverSignPublic', 'macBoxPublic']);
  if (c.version !== 1 || typeof c.channel !== 'string' || !idPattern.test(c.channel) ||
      !Number.isSafeInteger(c.expiresAt) || Number(c.expiresAt) <= now || Number(c.expiresAt) > now + PAIRING_MS ||
      typeof c.macTokenHash !== 'string' || !hashPattern.test(c.macTokenHash) ||
      typeof c.receiverTokenHash !== 'string' || !hashPattern.test(c.receiverTokenHash) || c.macTokenHash === c.receiverTokenHash) throw new SecretFailure('invalid_pairing');
  label(c.recipient, 64); encoded(c.receiverSignPublic, 32); encoded(c.macBoxPublic, 32);
  return c as unknown as SecretChannel;
}
