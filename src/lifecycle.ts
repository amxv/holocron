import { once } from 'node:events';
import { chmod, lstat, unlink } from 'node:fs/promises';
import { createServer, createConnection } from 'node:net';
import { join } from 'node:path';
import type { ProbeConfig } from './config.ts';
import type { AuthVerifier } from './auth.ts';
import { createProbeHttp } from './http.ts';
import type { ClipboardBridge } from './bridge.ts';
import { currentUid } from './private-state.ts';
import { BridgeFailure } from './text.ts';

const socketName = 'control.sock';
export async function localControl(directory: string, command: 'status' | 'stop'): Promise<Record<string, unknown>> {
  const path = join(directory, socketName);
  try {
    const info = await lstat(path);
    if (!info.isSocket() || info.uid !== currentUid() || (info.mode & 0o777) !== 0o600) throw new BridgeFailure('unsafe_control_socket');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { localTransport: 'stopped', tunnel: 'unverified', dot: 'unverified' };
    throw error;
  }
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    let output = '';
    socket.setTimeout(3000, () => socket.destroy(new BridgeFailure('local_control_timeout')));
    socket.once('connect', () => socket.end(JSON.stringify({ command }) + '\n'));
    socket.on('data', (data: Buffer) => { output += data.toString('utf8'); if (output.length > 4096) socket.destroy(); });
    socket.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ECONNREFUSED') resolve({ localTransport: 'stopped', tunnel: 'unverified', dot: 'unverified' });
      else reject(new BridgeFailure('local_control_failed'));
    });
    socket.once('end', () => { try { resolve(JSON.parse(output)); } catch { reject(new BridgeFailure('local_control_failed')); } });
  });
}

export async function startCompanion(config: ProbeConfig, verify: AuthVerifier, bridge: ClipboardBridge) {
  const store = bridge.store;
  const nonce = store.acquireRuntime();
  const path = join(store.directory, socketName);
  const http = createProbeHttp(config, verify, { bridge });
  let stopping: Promise<void> | undefined;
  let purgeTimer: NodeJS.Timeout | undefined;
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
        if (!data || typeof data !== 'object' || Object.keys(data).length !== 1 || !('command' in data)) throw new BridgeFailure('invalid_local_command');
        if (data.command === 'status') socket.end(JSON.stringify(bridge.status()));
        else if (data.command === 'stop') { await stop(); socket.end(JSON.stringify({ localTransport: 'stopped' })); }
        else throw new BridgeFailure('invalid_local_command');
      })().catch(() => socket.end(JSON.stringify({ error: 'local_operation_failed' })));
    });
  });
  control.maxConnections = 4;
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      clearInterval(purgeTimer);
      const stopped = bridge.stop();
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
      await stopped;
      control.close();
      store.releaseRuntime(nonce);
    })();
    return stopping;
  };
  let bound = false;
  try {
    // The durable singleton lease prevents two starters from removing each other's socket.
    try {
      const info = await lstat(path);
      if (!info.isSocket() || info.uid !== currentUid() || (info.mode & 0o777) !== 0o600) throw new BridgeFailure('unsafe_control_socket');
      await unlink(path);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    control.listen(path);
    await once(control, 'listening');
    bound = true;
    await chmod(path, 0o600);
    http.listen(config.port, '127.0.0.1');
    await once(http, 'listening');
    purgeTimer = setInterval(() => { try { store.purge(); } catch { /* Operations still fail closed on storage errors. */ } }, 60000);
    purgeTimer.unref();
    const done = once(control, 'close').then(() => {});
    return { stop, done, http };
  } catch (error) {
    http.closeAllConnections(); http.close(); control.close();
    if (bound) await unlink(path).catch(() => {});
    store.releaseRuntime(nonce);
    throw error;
  }
}
