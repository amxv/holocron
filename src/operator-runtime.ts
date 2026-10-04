import { spawn } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import { chmod, lstat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentUid, privateDirectory, readPrivateConfig } from './private-state.ts';
import { readSetup } from './setup-profile.ts';
import { readPairing, promptExecutable } from './secret-pairing.ts';
import { serveSecrets } from './secret-workflow.ts';
import { relayClient } from './secret-client.ts';
import { SecretFailure } from './secret-shapes.ts';
import type { SetupProfile } from './setup-profile.ts';
import { validateTunnelExecutable } from './tunnel-executable.ts';

const socketPath = (home: string) => join(home, 'operator.sock');
const quote = (v: string) => "'" + v.replaceAll("'", "'\\''") + "'";
export function tunnelArguments(profile: SetupProfile, healthFile: string): string[] {
  const command = [process.execPath, fileURLToPath(new URL('./holocron.js', import.meta.url)), 'stdio', '--local-config', profile.localConfig!].map(quote).join(' ');
  return ['run', '--profile-file', profile.tunnelProfile!, '--mcp.command', `command=${command},channel=main`,
    '--health.listen-addr', '127.0.0.1:0', '--health.url-file', healthFile, '--log.file', '/dev/null',
    '--log.http-raw-unsafe=false', '--harpoon.capture-payloads=false'];
}
export async function operatorControl(home: string, command: 'status' | 'stop'): Promise<Record<string, unknown>> {
  const path = socketPath(home);
  try {
    const info = await lstat(path);
    if (!info.isSocket() || info.uid !== currentUid() || (info.mode & 0o777) !== 0o600) throw new SecretFailure('unsafe_operator_socket');
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { runtime: 'stopped' }; throw error; }
  return new Promise((accept, reject) => {
    const socket = createConnection(path); let output = '';
    socket.setTimeout(3000, () => socket.destroy());
    socket.on('connect', () => socket.end(JSON.stringify({ command }) + '\n'));
    socket.on('data', (bytes: Buffer) => { output += bytes.toString('utf8'); if (output.length > 8192) socket.destroy(); });
    socket.on('error', (error: NodeJS.ErrnoException) => error.code === 'ECONNREFUSED' ? accept({ runtime: 'stopped', recoveryRequired: true }) : reject(new SecretFailure('operator_control_failed')));
    socket.on('end', () => { try { accept(JSON.parse(output)); } catch { reject(new SecretFailure('operator_control_failed')); } });
    socket.on('close', () => { if (!output) reject(new SecretFailure('operator_control_failed')); });
  });
}
export async function recoverOperator(home: string): Promise<void> {
  const state = await operatorControl(home, 'status');
  if (state.runtime !== 'stopped') throw new SecretFailure('stop_operator_before_setup');
  if (state.recoveryRequired) {
    const before = await lstat(socketPath(home));
    const again = await operatorControl(home, 'status');
    const after = await lstat(socketPath(home));
    if (!again.recoveryRequired || before.ino !== after.ino) throw new SecretFailure('operator_recovery_raced');
    await rm(socketPath(home));
  }
}
export async function startOperator(home: string, signal: AbortSignal, output: (value: unknown) => void): Promise<void> {
  const profile = await readSetup(home);
  if (profile.role !== 'mac') throw new SecretFailure('setup_mac_required');
  await privateDirectory(home); await promptExecutable(profile.prompt!);
  if (profile.pendingMacDirectory) throw new SecretFailure('incomplete_pairing_revoke_before_start');
  const before = await operatorControl(home, 'status');
  if (before.runtime === 'running') { output(before); return; }
  if (before.recoveryRequired) throw new SecretFailure('operator_stale_run_setup_recover');
  const savedPairings = await Promise.all(profile.macConfigs.map(path => readPairing(path, 'mac', true)));
  const pairings = savedPairings.filter(p => p.channel.expiresAt > Date.now());
  if (!pairings.length && !profile.tunnelProfile) throw new SecretFailure('operator_no_components_pair_or_configure_tunnel');
  if (profile.tunnelProfile) { await readPrivateConfig(profile.tunnelProfile); await validateTunnelExecutable(profile.tunnelClient!); }
  const stop = new AbortController(); const deadline = AbortSignal.any([signal, stop.signal]);
  const components: Record<string, unknown>[] = pairings.map(p => ({ component: 'secrets', recipient: p.channel.recipient, expiresAt: p.channel.expiresAt, state: 'starting', backend: 'unverified' }));
  const tunnel: Record<string, unknown> = { state: profile.tunnelProfile ? 'starting' : 'not-configured', readiness: 'unverified', discovery: 'unverified' };
  const status = () => ({ runtime: 'running', tunnel, secrets: components, pairing: pairings.length ? 'saved' : 'not-paired', remoteDiscovery: 'unverified' });
  let finished!: () => void; const shutdownDone = new Promise<void>(accept => { finished = accept; });
  const server = createServer({ allowHalfOpen: true }, socket => {
    let input = ''; socket.setTimeout(1000, () => socket.destroy()); socket.on('error', () => {});
    socket.on('data', (bytes: Buffer) => {
      input += bytes.toString('utf8'); if (input.length > 128) { socket.destroy(); return; }
      if (!input.endsWith('\n')) return;
      socket.pause();
      try {
        const message = JSON.parse(input);
        if (Object.keys(message).length !== 1 || !['status', 'stop'].includes(message.command)) throw new Error();
        if (message.command === 'stop') { socket.setTimeout(0); stop.abort(); void shutdownDone.then(() => socket.end('{"runtime":"stopped"}')); }
        else void health().then(() => socket.end(JSON.stringify(status())), () => socket.end(JSON.stringify(status())));
      } catch { socket.end('{"error":"invalid_local_command"}'); }
    });
  });
  server.maxConnections = 4;
  const healthFile = join(home, 'tunnel-health.url');
  const health = async () => {
    if (tunnel.state !== 'running') return;
    try {
      const url = new URL((await readPrivateConfig(healthFile)).toString('utf8').trim());
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || !url.port) throw new Error();
      const response = await fetch(new URL('/readyz', url), { redirect: 'error', signal: AbortSignal.timeout(1500) });
      await response.body?.cancel(); tunnel.readiness = response.ok ? 'ready' : 'not-ready';
    } catch { tunnel.readiness = 'unverified'; }
  };
  let bound = false; let healthOwned = false; let child: ReturnType<typeof spawn> | undefined; let childDone: Promise<void> | undefined;
  const tasks: Promise<void>[] = [];
  try {
    await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(socketPath(home), () => accept()); });
    bound = true; await chmod(socketPath(home), 0o600);
    if (profile.tunnelProfile) {
      // Only this supervisor's child is signalled. Existing tunnel aliases/jobs stay untouched.
      try { await lstat(healthFile); throw new SecretFailure('operator_health_file_conflict'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      healthOwned = true;
      child = spawn(profile.tunnelClient!, tunnelArguments(profile, healthFile), { stdio: 'ignore', shell: false, cwd: fileURLToPath(new URL('.', import.meta.url)), env: process.env });
      childDone = new Promise<void>(accept => {
        child!.once('spawn', () => { tunnel.state = 'running'; });
        child!.once('error', () => { tunnel.state = 'failed'; stop.abort(); accept(); });
        child!.once('exit', () => { tunnel.state = deadline.aborted ? 'stopped' : 'failed'; stop.abort(); accept(); });
      });
    }
    for (const [index, pairing] of pairings.entries()) {
      const component = components[index]!; const call = relayClient(pairing);
      tasks.push(serveSecrets({ ...pairing, prompt: profile.prompt! }, deadline, { call: async (a, d, s) => {
        try { const result = await call(a, d, s); component.state = 'running'; component.backend = 'reachable'; return result; }
        catch (error) { component.backend = 'unavailable'; throw error; }
      } }).catch(() => { if (!deadline.aborted) { component.state = 'failed'; stop.abort(); } }));
    }
    output(status());
    await new Promise<void>(accept => { if (deadline.aborted) accept(); else deadline.addEventListener('abort', () => accept(), { once: true }); });
    stop.abort();
  } finally {
    stop.abort();
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM'); const kill = setTimeout(() => child!.kill('SIGKILL'), 3000);
      await childDone; clearTimeout(kill);
    }
    await Promise.all(tasks);
    finished();
    if (bound) { await new Promise<void>(accept => server.close(() => accept())); await rm(socketPath(home), { force: true }); }
    if (healthOwned) await rm(healthFile, { force: true });
  }
  if (tunnel.state === 'failed' || components.some(c => c.state === 'failed')) throw new SecretFailure('operator_component_failed');
}
