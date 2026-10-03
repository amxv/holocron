import { constants } from 'node:fs';
import { access, lstat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { BridgeFailure, TEXT_LIMIT, validUtf8 } from './text.ts';
import { sha256, verifyDigest } from './digest.ts';
import { runCloud, spawnCloud } from './cloud-process.ts';
import type { CloudCommand, CloudSpawner } from './cloud-process.ts';

const MIME = 'text/plain;charset=utf-8';
export const OWNER_MAX_MS = 30 * 60 * 1000;
export interface CloudEnvironment {
  platform: string;
  env: NodeJS.ProcessEnv;
  executable(path: string): Promise<boolean>;
  socket(path: string): Promise<boolean>;
}
export const nativeCloudEnvironment: CloudEnvironment = {
  platform: process.platform, env: process.env,
  async executable(path) {
    try { const info = await lstat(path); await access(path, constants.X_OK); return info.isFile() || info.isSymbolicLink(); }
    catch { return false; }
  },
  async socket(path) { try { return (await lstat(path)).isSocket(); } catch { return false; } },
};

export function cloudText(bytes: Uint8Array): string {
  const text = validUtf8(bytes, TEXT_LIMIT);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(text)) throw new BridgeFailure('binary_text');
  return text;
}

export interface CloudProbe {
  backend: 'wayland' | null;
  availability: 'candidate' | 'unavailable';
  reason?: string;
  viewedDesktop: 'unverified';
  clipboardAccess: 'unverified';
}

export class CloudClipboard {
  private environment: CloudEnvironment;
  private spawner: CloudSpawner;
  constructor(environment = nativeCloudEnvironment, spawner: CloudSpawner = spawnCloud) {
    this.environment = environment; this.spawner = spawner;
  }

  private async command(write: boolean): Promise<CloudCommand> {
    const { platform, env } = this.environment;
    if (platform !== 'linux') throw new BridgeFailure('unsupported_platform');
    // Require an explicitly named graphical session. Never guess wayland-0 or use an inherited fd.
    const display = env.WAYLAND_DISPLAY;
    const runtime = env.XDG_RUNTIME_DIR;
    if (!display || !runtime || !isAbsolute(runtime) || display.includes('\0') || runtime.includes('\0') ||
        (!isAbsolute(display) && !/^[A-Za-z0-9._-]+$/.test(display))) throw new BridgeFailure('wayland_session_missing');
    const socket = isAbsolute(display) ? display : join(runtime, display);
    if (!await this.environment.socket(socket)) throw new BridgeFailure('wayland_socket_missing');
    const present = await Promise.all(['/usr/bin/wl-copy', '/usr/bin/wl-paste'].map((path) => this.environment.executable(path)));
    if (present.some((exists) => !exists)) throw new BridgeFailure('wayland_binaries_missing');
    return { executable: write ? '/usr/bin/wl-copy' : '/usr/bin/wl-paste',
      args: write ? ['--foreground', '--type', MIME] : ['--no-newline', '--type', MIME],
      // Do not forward credentials, config, PATH, preload hooks, WAYLAND_DEBUG or tunnel settings.
      env: { LANG: 'C.UTF-8', XDG_RUNTIME_DIR: runtime, WAYLAND_DISPLAY: display } };
  }

  async probe(): Promise<CloudProbe> {
    try {
      await this.command(false);
      return { backend: 'wayland', availability: 'candidate', viewedDesktop: 'unverified', clipboardAccess: 'unverified' };
    } catch (error) {
      return { backend: null, availability: 'unavailable', reason: error instanceof BridgeFailure ? error.code : 'backend_unavailable',
        viewedDesktop: 'unverified', clipboardAccess: 'unverified' };
    }
  }

  async read(signal: AbortSignal): Promise<{ backend: 'wayland'; text: string; byteCount: number; sha256: string; viewedDesktop: 'unverified' }> {
    if (signal.aborted) throw new BridgeFailure('backend_cancelled');
    const bytes = await runCloud(await this.command(false), signal, this.spawner);
    return { backend: 'wayland', text: cloudText(bytes), byteCount: bytes.length, sha256: sha256(bytes), viewedDesktop: 'unverified' };
  }

  /** Foreground ownership is intentional. Publication is verified once; no clipboard watcher. */
  async write(bytes: Buffer, expected: string, signal: AbortSignal, owned: (result: Record<string, unknown>) => void): Promise<Record<string, unknown>> {
    cloudText(bytes); verifyDigest(bytes, expected);
    if (signal.aborted) throw new BridgeFailure('backend_cancelled');
    const command = await this.command(true);
    const lifetime = new AbortController();
    const ownerSignal = AbortSignal.any([signal, lifetime.signal]);
    const worker = this.spawner(command, bytes, ownerSignal);
    const startup = setTimeout(() => lifetime.abort(), 2000);
    let published = false;
    let expired = false;
    let hold: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([worker.fed, worker.done.then(() => { throw new BridgeFailure('ownership_ended_before_verification'); })]);
      // wl-copy has no ready protocol. Bounded verification retries allow it to advertise the selection.
      while (!ownerSignal.aborted && worker.running()) {
        try {
          const captured = await this.read(ownerSignal);
          if (captured.sha256 === expected && captured.byteCount === bytes.length && Buffer.from(captured.text, 'utf8').equals(bytes)) { published = true; break; }
        } catch (error) { if (ownerSignal.aborted) throw error; }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(done, 25);
          function done() { clearTimeout(timer); ownerSignal.removeEventListener('abort', done); resolve(); }
          ownerSignal.addEventListener('abort', done, { once: true });
          if (ownerSignal.aborted) done();
        });
      }
      clearTimeout(startup);
      if (!published || !worker.running() || ownerSignal.aborted) throw new BridgeFailure('publication_unverified');
      hold = setTimeout(() => { expired = true; lifetime.abort(); }, OWNER_MAX_MS);
      owned({ state: 'owned', backend: 'wayland', byteCount: bytes.length, sha256: expected,
        lifetime: 'foreground-process', maximumHoldMs: OWNER_MAX_MS, viewedDesktop: 'unverified' });
      const ended = await worker.done;
      return { state: 'ownership-ended', backend: 'wayland', reason: ended.code === 0 && !ended.signal ? 'backend_released' : 'backend_failed',
        viewedDesktop: 'unverified' };
    } catch (error) {
      if (published) return { state: 'ownership-ended', backend: 'wayland', reason: expired ? 'hold_expired' : signal.aborted ? 'cancelled' : 'backend_failed',
        viewedDesktop: 'unverified' };
      if (lifetime.signal.aborted && !signal.aborted) throw new BridgeFailure('publication_timeout');
      throw error;
    } finally {
      clearTimeout(startup); clearTimeout(hold); lifetime.abort(); worker.stop();
      await worker.done.catch(() => {});
    }
  }
}
