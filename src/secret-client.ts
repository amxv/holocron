import { setTimeout as delay } from 'node:timers/promises';
import { SecretFailure, SECRET_WIRE_LIMIT } from './secret-shapes.ts';
import type { SecretPairing } from './secret-pairing.ts';

export type RelayCall = (action: string, data: unknown, signal?: AbortSignal) => Promise<Record<string, unknown>>;
export function relayClient(pairing: Pick<SecretPairing, 'relay' | 'channel' | 'token'>, fetcher = fetch): RelayCall {
  return async (action, data, signal) => {
    const response = await fetcher(pairing.relay, { method: 'POST', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(10_000)]),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pairing.token}` },
      body: JSON.stringify({ action, channel: pairing.channel.channel, data }) });
    const reader = response.body?.getReader(); if (!reader) throw new SecretFailure('relay_unavailable');
    let size = 0; const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const next = await reader.read(); if (next.done) break;
        size += next.value.length;
        if (size > SECRET_WIRE_LIMIT) { await reader.cancel(); throw new SecretFailure('invalid_relay_response'); }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!response.ok || !value || typeof value !== 'object' || Array.isArray(value)) {
      const known = ['unauthorized', 'request_busy', 'request_replayed', 'request_unavailable', 'rate_limited', 'request_rate_limited', 'pairing_exists', 'pairing_code_expired_or_invalid', 'pairing_code_used',
        'message_expired', 'message_unavailable', 'message_replayed', 'inbox_full'];
      throw new SecretFailure(known.includes(value?.error) ? value.error : 'relay_unavailable');
    }
    return value;
  };
}
export async function waitSecret(signal: AbortSignal, interval = 1000): Promise<void> {
  await delay(interval, undefined, { signal });
}
