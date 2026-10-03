import type { Readable, Writable } from 'node:stream';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';
import type { JSONRPCMessage, RequestId } from '@modelcontextprotocol/sdk/types.js';
import { TEXT_LIMIT } from './text.ts';

export const STDIO_FRAME_LIMIT = 6 * TEXT_LIMIT + 16384;
export const STDIO_CONCURRENT_LIMIT = 16;
const OUTPUT_LIMIT = 4 * STDIO_FRAME_LIMIT;
const key = (id: RequestId) => `${typeof id}:${id}`;

// The official newline-delimited transport contract, with bounded input,
// outstanding RPCs and output, fatal malformed frames, and EOF shutdown.
export class BoundedStdioTransport implements Transport {
  onmessage?: Transport['onmessage'];
  onclose?: () => void;
  onerror?: (error: Error) => void;
  private started = false;
  private closed = false;
  private buffer = Buffer.allocUnsafe(STDIO_FRAME_LIMIT);
  private size = 0;
  private pending = new Map<string, AbortController>();
  private outputBytes = 0;
  private sends = new Set<(error: Error) => void>();
  private input: Readable;
  private output: Writable;

  constructor(input: Readable, output: Writable) { this.input = input; this.output = output; }

  private fail = () => {
    if (this.closed) return;
    this.onerror?.(new Error('stdio_transport_failed'));
    void this.close();
  };
  private eof = () => {
    if (this.size) this.fail();
    else void this.close();
  };
  private data = (chunk: Buffer) => {
    try {
      let offset = 0;
      while (!this.closed && offset < chunk.length) {
        const newline = chunk.indexOf(10, offset);
        const end = newline < 0 ? chunk.length : newline;
        const part = chunk.subarray(offset, end);
        if (this.size + part.length > STDIO_FRAME_LIMIT) throw new Error('frame_limit');
        part.copy(this.buffer, this.size); this.size += part.length;
        if (newline < 0) break;
        const frame = this.buffer.subarray(0, this.size);
        this.size = 0;
        const message = JSONRPCMessageSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(frame)));
        if (!('method' in message)) throw new Error('unexpected_response');
        if ('id' in message) {
          if ((typeof message.id === 'string' && message.id.length > 128) ||
              (typeof message.id === 'number' && !Number.isSafeInteger(message.id)) ||
              this.pending.has(key(message.id)) || this.pending.size >= STDIO_CONCURRENT_LIMIT) throw new Error('request_limit');
          this.pending.set(key(message.id), new AbortController());
        } else if (message.method === 'notifications/cancelled') {
          // The local server uses this signal, including JSON-RPC ID zero.
          const id = message.params?.requestId;
          if (typeof id === 'string' || typeof id === 'number') this.pending.get(key(id))?.abort();
        }
        this.onmessage?.(message);
        offset = newline + 1;
      }
    } catch { this.fail(); }
  };

  async start(): Promise<void> {
    if (this.started || this.closed) throw new Error('stdio_transport_unavailable');
    this.started = true;
    this.input.on('data', this.data);
    this.input.once('end', this.eof);
    this.input.once('close', this.eof);
    this.input.on('error', this.fail);
    this.output.on('error', this.fail);
    this.output.once('close', this.fail);
    if (this.input.readableEnded || this.input.destroyed || this.output.destroyed) this.eof();
  }

  requestSignal(id: RequestId): AbortSignal {
    return this.pending.get(key(id))?.signal ?? AbortSignal.abort();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.closed) throw new Error('stdio_transport_unavailable');
    if ('id' in message && message.id !== undefined && this.pending.get(key(message.id))?.signal.aborted) {
      this.pending.delete(key(message.id)); return;
    }
    const frame = JSON.stringify(message) + '\n';
    const bytes = Buffer.byteLength(frame);
    if (bytes > STDIO_FRAME_LIMIT || this.outputBytes + bytes > OUTPUT_LIMIT) {
      this.fail(); throw new Error('stdio_transport_failed');
    }
    this.outputBytes += bytes;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error | null) => {
        if (settled) return;
        settled = true; this.outputBytes -= bytes; this.sends.delete(finish);
        if (error) reject(new Error('stdio_transport_failed'));
        else { if ('id' in message && message.id !== undefined) this.pending.delete(key(message.id)); resolve(); }
      };
      this.sends.add(finish);
      try { this.output.write(frame, finish); } catch { finish(new Error('stdio_transport_failed')); this.fail(); }
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.input.off('data', this.data); this.input.off('end', this.eof); this.input.off('close', this.eof);
    this.input.off('error', this.fail); this.input.pause(); this.input.destroy();
    this.output.off('close', this.fail);
    // Keep the error listener until process teardown to absorb late EPIPE.
    this.buffer = Buffer.alloc(0); this.size = 0;
    for (const controller of this.pending.values()) controller.abort();
    this.pending.clear();
    for (const finish of this.sends) finish(new Error('stdio_transport_unavailable'));
    // A stopped reader must not keep native pipe writes alive during shutdown.
    this.output.destroy();
    this.onclose?.();
  }
}
