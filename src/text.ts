export const TEXT_LIMIT = 256 * 1024;
export const FILE_LIMIT = 10 * 1024 * 1024;
export const AGGREGATE_LIMIT = 100 * 1024 * 1024;
export const READ_LIMIT = 64 * 1024;
export const SHARE_TTL_MS = 24 * 60 * 60 * 1000;
export const REQUEST_TTL_MS = 5 * 60 * 1000;
export const RECEIPT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class BridgeFailure extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}

export function validUtf8(bytes: Uint8Array, limit = TEXT_LIMIT): string {
  if (bytes.byteLength > limit) throw new BridgeFailure('text_too_large');
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new BridgeFailure('invalid_utf8'); }
}

export function literalBytes(text: string): Buffer {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.toString('utf8') !== text) throw new BridgeFailure('invalid_utf8');
  validUtf8(bytes);
  return bytes;
}

export function contextUtf8(bytes: Uint8Array): void {
  if (bytes.byteLength > FILE_LIMIT) throw new BridgeFailure('file_too_large');
  const text = validUtf8(bytes, FILE_LIMIT);
  // UTF-8 decoding alone accepts NUL and other binary control data. Keep this
  // restriction file-specific: literal clipboard text retains its prior contract.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(text)) throw new BridgeFailure('binary_file');
}

export function safeName(name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/.test(name) || name.trim() !== name) throw new BridgeFailure('invalid_display_name');
  return name;
}

export function deadline(value: string): number {
  const time = Date.parse(value);
  if (!Number.isSafeInteger(time) || new Date(time).toISOString() !== value) throw new BridgeFailure('invalid_deadline');
  return time;
}
