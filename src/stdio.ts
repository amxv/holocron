import { once } from 'node:events';
import { chmod, lstat, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import type { ClipboardBridge } from './bridge.ts';
import { makeLocalMcpServer } from './mcp.ts';
import { currentUid } from './private-state.ts';
import { BoundedStdioTransport } from './stdio-transport.ts';
import { BridgeFailure } from './text.ts';
import type { PairedTextService } from './paired-text.ts';

export async function startStdio(bridge: ClipboardBridge, input: Readable, output: Writable, error: (line: string) => void,
  paired?: PairedTextService) {
  const store = bridge.store;
  const operation = new AbortController();
  const transport = new BoundedStdioTransport(input, output);
  const mcp = makeLocalMcpServer(bridge, operation.signal, (id) => transport.requestSignal(id), paired);
  const nonce = store.acquireRuntime();
  const path = join(store.directory, 'control.sock');
  let failed = false;
  let bound = false;
  let stopping: Promise<void> | undefined;
  let purgeTimer: NodeJS.Timeout | undefined;
  let finished!: (code: number) => void;
  const done = new Promise<number>((resolve) => { finished = resolve; });
  const control = createServer({ allowHalfOpen: true }, (socket) => {
    let input = '';
    socket.setTimeout(1000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', (chunk: Buffer) => {
      input += chunk.toString('utf8');
      if (input.length > 128) { socket.destroy(); return; }
      if (!input.endsWith('\n')) return;
      socket.pause();
      void (async () => {
        const data: unknown = JSON.parse(input);
        if (!data || typeof data !== 'object' || Object.keys(data).length !== 1 || !('command' in data)) throw new Error('invalid_command');
        if (data.command === 'status') socket.end(JSON.stringify({ ...bridge.status(),
          oauthProvider: 'not-required', transport: 'stdio', trustBoundary: 'same-user-private-tunnel' }));
        else if (data.command === 'stop') { await stop(); socket.end(JSON.stringify({ localTransport: 'stopped' })); }
        else throw new Error('invalid_command');
      })().catch(() => socket.end(JSON.stringify({ error: 'local_operation_failed' })));
    });
  });
  control.maxConnections = 4;
  const stop = (): Promise<void> => {
    stopping ??= Promise.resolve().then(async () => {
      operation.abort(); clearInterval(purgeTimer);
      try {
        await mcp.close();
        await bridge.stop();
      } finally {
        control.close();
        if (bound) await unlink(path).catch(() => {});
        store.releaseRuntime(nonce);
        finished(failed ? 1 : 0);
      }
    });
    return stopping;
  };
  transport.onerror = () => { failed = true; error('stdio_transport_failed'); };
  transport.onclose = () => { void stop().catch(() => { failed = true; finished(1); }); };
  // Never print SDK errors, which may include request values or private paths.
  mcp.server.onerror = () => {};
  try {
    try {
      const info = await lstat(path);
      if (!info.isSocket() || info.uid !== currentUid() || (info.mode & 0o777) !== 0o600) throw new BridgeFailure('unsafe_control_socket');
      await unlink(path);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    control.listen(path);
    await once(control, 'listening'); bound = true;
    await chmod(path, 0o600);
    await mcp.connect(transport);
    if (!stopping) {
      purgeTimer = setInterval(() => { try { store.purge(); } catch { /* Reads still fail closed. */ } }, 60000);
      purgeTimer.unref();
    }
    return { stop, done };
  } catch (error) {
    failed = true;
    await stop();
    throw error;
  }
}
