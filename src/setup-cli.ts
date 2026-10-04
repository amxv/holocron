import { mkdir, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { holocronHome } from './holocron-profile.ts';
import { privateDirectory } from './private-state.ts';
import { readSetup, saveSetup, setupMac, DEFAULT_RELAY } from './setup-profile.ts';
import { offerPairing, receivePairing } from './pairing-code.ts';
import { readPairing } from './secret-pairing.ts';
import { operatorControl, recoverOperator, startOperator } from './operator-runtime.ts';
import { SecretFailure } from './secret-shapes.ts';
import type { CliIO } from './cli-main.ts';
import { relayClient } from './secret-client.ts';

const help = `Usage: holocron setup [--admin-file ABS] [--local-config ABS] [--tunnel-profile ABS --tunnel-client ABS] [--mac-config ABS] [--prompt ABS]
       holocron setup receiver --code CODE [--recipient LABEL] [--renew]
       holocron setup --recover
       holocron pair [--recover]
       holocron start | stop | status
Mac setup saves private references, builds the native approval helper and reuses linked Board/MCP configuration.
The existing tunnel profile supplies its own identity and credential references; no account or tunnel is created.
start runs the configured tunnel and saved secret services in the foreground. stop addresses only that owned supervisor.
status without flags reports component states for a configured setup; explicit --local-config/--config keeps legacy behavior.
pair prints a unique five-minute code. Receiver setup prints eight verification digits for the Mac's native approval.
Exchange the code and verification number through your trusted conversation. No descriptor/fingerprint files to exchange.
Pairing lasts seven days. ask -m PURPOSE NAME uses the saved receiver. Existing file pairing commands remain available.`;
function flags(args: string[], allowed: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i]!;
    if (!allowed.includes(key) || result[key] !== undefined) throw new SecretFailure('invalid_arguments');
    if (['--renew', '--recover'].includes(key)) result[key] = 'true';
    else { const value = args[++i]; if (!value || value.startsWith('--')) throw new SecretFailure('invalid_arguments'); result[key] = value; }
  }
  return result;
}
export async function runSetupCli(args: string[], io: CliIO, signal: AbortSignal, env = process.env): Promise<number> {
  if (args.includes('--help')) { io.out(help); return 0; }
  try {
    const home = await holocronHome(env); const command = args[0];
    if (command === 'start') { if (args.length !== 1) throw new SecretFailure('invalid_arguments'); await startOperator(home, signal, value => io.out(JSON.stringify(value))); return 0; }
    if (command === 'stop' || command === 'status') {
      if (args.length !== 1) throw new SecretFailure('invalid_arguments');
      const p = await readSetup(home);
      if (command === 'stop') io.out(JSON.stringify(await operatorControl(home, 'stop')));
      else {
        const runtime = await operatorControl(home, 'status');
        let receiver: unknown = p.role === 'receiver' ? 'not-paired' : undefined;
        if (p.receiverConfig) { try { const pair = await readPairing(p.receiverConfig, 'receiver'); receiver = { state: 'paired', recipient: pair.channel.recipient, expiresAt: pair.channel.expiresAt }; } catch { receiver = { state: 'expired-or-unavailable' }; } }
        io.out(JSON.stringify({ setup: p.role, ...runtime, ...(runtime.runtime === 'stopped' ? { tunnel: p.tunnelProfile ? 'configured' : 'not-configured', secrets: p.macConfigs.length ? 'configured' : 'not-paired' } : {}), ...(receiver ? { receiver } : {}), ...(p.pendingMacDirectory ? { recovery: 'incomplete-pairing', directory: p.pendingMacDirectory } : {}) }));
      }
      return 0;
    }
    await privateDirectory(home);
    // mkdir is the cross-process mutation lock. It never contains credentials.
    const lock = join(home, 'setup.lock');
    try { await mkdir(lock, { mode: 0o700 }); } catch { throw new SecretFailure('setup_busy_or_interrupted_inspect_setup_lock'); }
    try {
      if (command === 'pair') {
        if (!(args.length === 1 || args.length === 2 && args[1] === '--recover')) throw new SecretFailure('invalid_arguments');
        const p = await readSetup(home);
        if (p.role !== 'mac') throw new SecretFailure('setup_mac_required');
        if (args[1] === '--recover') {
          if (p.pendingMacDirectory) {
            const pairing = await readPairing(join(p.pendingMacDirectory, 'mac.json'), 'mac', true);
            if (pairing.channel.expiresAt > Date.now()) {
              const result = await relayClient(pairing)('revoke', {}, signal);
              if (result.ok !== true) throw new SecretFailure('invalid_relay_response');
            }
            delete p.pendingMacDirectory; await saveSetup(home, p);
          }
          io.out('Incomplete pairing revoked or expired. Run holocron pair for a fresh code.'); return 0;
        }
        if (p.pendingMacDirectory) throw new SecretFailure('incomplete_pairing_revoke_retained_mac_config');
        const parent = join(home, 'pairings'); await privateDirectory(parent);
        const directory = join(parent, randomUUID());
        p.pendingMacDirectory = directory; await saveSetup(home, p);
        try {
          const path = await offerPairing({ directory, relay: p.relay, prompt: p.prompt!, adminFile: p.adminFile! }, signal, { output: io.out });
          p.macConfigs.push(path); delete p.pendingMacDirectory; await saveSetup(home, p);
          io.out('Saved pairing. Run holocron start to approve key requests.');
        } catch (error) {
          // Preserve uncertain provisioning for revocation, clear only absent local state.
          try { await readPairing(join(directory, 'mac.json'), 'mac'); }
          catch (missing) { if ((missing as NodeJS.ErrnoException).code === 'ENOENT') { delete p.pendingMacDirectory; await saveSetup(home, p); } }
          throw error;
        }
        return 0;
      }
      if (command !== 'setup') throw new SecretFailure('invalid_arguments');
      if (args[1] === 'receiver') {
        const f = flags(args.slice(2), ['--code', '--recipient', '--relay', '--renew']);
        let previous;
        try { previous = await readSetup(home); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        if (previous?.role === 'mac') throw new SecretFailure('setup_role_conflict');
        if (previous?.receiverConfig && !f['--renew']) { await readPairing(previous.receiverConfig, 'receiver'); io.out('Receiver already paired. Use holocron ask -m PURPOSE NAME.'); return 0; }
        if (!f['--code']) throw new SecretFailure('setup_receiver_needs_code');
        const parent = join(home, 'pairings'); await privateDirectory(parent);
        const relay = f['--relay'] ?? previous?.relay ?? DEFAULT_RELAY;
        const path = await receivePairing({ directory: join(parent, randomUUID()), relay, recipient: f['--recipient'] ?? hostname().slice(0, 64), code: f['--code'] }, signal, { output: io.out });
        await saveSetup(home, { version: 1, role: 'receiver', relay, receiverConfig: path, macConfigs: [] });
        io.out('Receiver paired. Use holocron ask -m PURPOSE NAME.'); return 0;
      }
      const f = flags(args.slice(1), ['--admin-file', '--local-config', '--tunnel-profile', '--tunnel-client', '--mac-config', '--prompt', '--relay', '--recover']);
      const state = await operatorControl(home, 'status');
      if (state.runtime !== 'stopped') throw new SecretFailure('stop_operator_before_setup');
      if (f['--recover']) { if (Object.keys(f).length !== 1) throw new SecretFailure('invalid_arguments'); await recoverOperator(home); io.out('Owned stale runtime socket recovered. Setup references retained.'); return 0; }
      await setupMac(home, f, signal); io.out('Mac setup saved. Run holocron pair, then holocron start.'); return 0;
    } finally { await rmdir(lock); }
  } catch (error) {
    io.error(signal.aborted ? 'operation_cancelled' : error instanceof SecretFailure ? error.code : 'setup_operation_failed');
    return error instanceof SecretFailure && error.code === 'invalid_arguments' ? 2 : 1;
  }
}
