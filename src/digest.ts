import { createHash } from 'node:crypto';
import { BridgeFailure } from './text.ts';

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function requireDigest(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new BridgeFailure('invalid_digest');
}

export function verifyDigest(bytes: Uint8Array, expected: string): void {
  requireDigest(expected);
  if (sha256(bytes) !== expected) throw new BridgeFailure('digest_mismatch');
}
