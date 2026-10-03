import { createHash } from 'node:crypto';
import type { ClipboardAdapter } from './clipboard.ts';
import { ClipboardFailure } from './clipboard.ts';
import type { ShareStore, ClipboardReceipt } from './store.ts';
import { BridgeFailure, REQUEST_TTL_MS, deadline, literalBytes, safeName } from './text.ts';

export interface WriteRequest { request_id: string; text: string; valid_until: string }

export class ClipboardBridge {
  private stopped = false;
  private active: { id: string; fingerprint: string; promise: Promise<ClipboardReceipt>; abort: AbortController } | undefined;
  readonly store: ShareStore;
  readonly adapter: ClipboardAdapter;
  private now: () => number;
  constructor(store: ShareStore, adapter: ClipboardAdapter, now = Date.now) {
    this.store = store; this.adapter = adapter; this.now = now;
  }

  async capture(name?: string, signal = AbortSignal.timeout(2500)) {
    if (this.stopped) throw new BridgeFailure('bridge_stopped');
    if (name !== undefined) safeName(name);
    const bytes = await this.adapter.read(signal);
    if (this.stopped || signal.aborted) throw new BridgeFailure('request_cancelled');
    return this.store.capture(bytes, name);
  }

  status() {
    return { mode: 'explicit-text-bridge' as const, localTransport: this.stopped ? 'stopped' as const : 'available' as const,
      tunnel: 'unverified' as const, dot: 'unverified' as const, cloudClipboard: 'unverified' as const, oauthProvider: 'unverified' as const,
      macClipboard: this.adapter.availability, liveMacClipboard: 'unverified' as const,
      capabilities: ['explicit-text-share', 'explicit-file-share', 'shared-text-read', 'shared-file-read', ...(this.adapter.availability === 'unavailable' ? [] : ['literal-mac-clipboard-write'])],
      ...this.store.counts() };
  }

  write(request: WriteRequest, callerSignal: AbortSignal, authorized: () => boolean): Promise<ClipboardReceipt> {
    try {
      if (this.stopped || callerSignal.aborted || !authorized()) throw new BridgeFailure('bridge_unavailable');
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(request.request_id)) throw new BridgeFailure('invalid_request_id');
      const bytes = literalBytes(request.text);
      const expires = deadline(request.valid_until);
      const fingerprint = createHash('sha256').update(JSON.stringify([request.text, request.valid_until])).digest('hex');
      this.store.purge();
      const previous = this.store.receipt(request.request_id);
      if (previous) {
        if (previous.fingerprint !== fingerprint || previous.valid_until !== request.valid_until) throw new BridgeFailure('request_conflict');
        if (this.active?.id === request.request_id) return this.active.promise;
        return Promise.resolve(this.store.publicReceipt(previous));
      }
      if (expires <= this.now() || expires > this.now() + REQUEST_TTL_MS) throw new BridgeFailure('request_expired_or_overlong');
      // Distinct writes fail busy; there is no offline, reconnect, or in-memory delivery queue.
      if (this.active) throw new BridgeFailure('clipboard_busy');
      if (this.adapter.availability === 'unavailable') throw new BridgeFailure('clipboard_unavailable');
      this.store.beginReceipt(request.request_id, fingerprint, request.valid_until, bytes.length);
      const abort = new AbortController();
      const cancel = () => abort.abort();
      callerSignal.addEventListener('abort', cancel, { once: true });
      if (callerSignal.aborted) abort.abort();
      const timer = setTimeout(cancel, Math.max(1, Math.min(2000, expires - this.now())));
      // Start after the durable claim, but before yielding to another request.
      const promise = this.perform(request.request_id, bytes, expires, abort.signal, authorized).finally(() => {
        clearTimeout(timer);
        callerSignal.removeEventListener('abort', cancel);
        this.active = undefined;
      });
      this.active = { id: request.request_id, fingerprint, promise, abort };
      return promise;
    } catch (error) { return Promise.reject(error); }
  }

  private async perform(id: string, bytes: Buffer, expires: number, signal: AbortSignal, authorized: () => boolean): Promise<ClipboardReceipt> {
    let state: ClipboardReceipt['state'];
    let reason: string | undefined;
    try {
      if (this.stopped || signal.aborted || this.now() >= expires || !authorized()) throw new ClipboardFailure(false);
      await this.adapter.write(bytes, signal);
      if (signal.aborted || this.stopped || this.now() >= expires || !authorized()) {
        state = 'uncertain'; reason = 'interrupted';
      } else state = 'completed';
    } catch (error) {
      state = error instanceof ClipboardFailure && !error.uncertain ? 'failed' : 'uncertain';
      reason = state === 'failed' ? 'clipboard_unavailable' : 'interrupted';
    }
    try { return this.store.finishReceipt(id, state, reason); }
    catch {
      // A dispatched write and receipt commit cannot be atomic. Keep the durable started claim.
      return this.store.publicReceipt(this.store.receipt(id)!);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.active?.abort.abort();
    await this.active?.promise;
  }
}
