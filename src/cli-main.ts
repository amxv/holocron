import type { ClipboardAdapter } from './clipboard.ts';
import { macClipboard } from './clipboard.ts';
import { ClipboardBridge } from './bridge.ts';
import { loadConfig } from './config.ts';
import { makeVerifier, ownerId } from './auth.ts';
import { ShareStore } from './store.ts';
import { stateDirectory } from './private-state.ts';
import { localControl, startCompanion } from './lifecycle.ts';
import { BridgeFailure, TEXT_LIMIT, safeName } from './text.ts';
import { readSelectedFile } from './file-snapshot.ts';
import { VERSION } from './mcp.ts';
import { preparePlugin } from './plugin.ts';
import { loginAction } from './login.ts';
import type { LoginEnvironment } from './login.ts';

const help = `Usage: shared-clipboard <start|stop|status|check-config|capture|share-text|list|clear> --config <private JSON file>
       shared-clipboard <capture|share-text> --config <private JSON file> [--name <safe label>]
       shared-clipboard share-file <selected UTF-8 file> --config <private JSON file> [--name <safe label>]
       shared-clipboard revoke <share ID> --config <private JSON file>
       shared-clipboard prepare-plugin --connection-id <registered ID> --output <new directory>
       shared-clipboard <login-install|login-status|login-remove> --config <absolute private JSON file>
capture explicitly reads the Mac clipboard. share-text reads UTF-8 stdin only.
share-file snapshots one explicitly selected regular UTF-8 file, at most 10 MiB, without exposing its path.
start runs in the foreground; stop uses an owner-only local socket. No automatic clipboard reads, paste, or command execution.
login-install explicitly writes an optional next-login LaunchAgent only; it does not start or load a job now.
login-remove disables future login starts only; stop the current companion separately. See docs/operations.md.
Actual provider, tunnel, Dots and OS clipboard verification remain deferred. See docs/text-bridge.md.`;

export interface CliIO {
  stdin: AsyncIterable<Uint8Array>;
  out: (line: string) => void;
  error: (line: string) => void;
}

export async function runCli(args: string[], io: CliIO, adapter: ClipboardAdapter = macClipboard(), loginEnvironment?: LoginEnvironment): Promise<number> {
  if (args.length === 1 && args[0] === '--help') { io.out(help); return 0; }
  if (args.length === 1 && args[0] === '--version') { io.out(VERSION); return 0; }
  if (args.length === 5 && args[0] === 'prepare-plugin' && args[1] === '--connection-id' && args[3] === '--output') {
    try { await preparePlugin(args[2]!, args[4]!); io.out('Private plugin mapping prepared. Actual installation and Dots calls remain unverified.'); return 0; }
    catch { io.error('Plugin preparation failed. Use a real registered ID and a new output directory.'); return 1; }
  }
  let store: ShareStore | undefined;
  try {
    const command = args[0];
    const index = args.indexOf('--config');
    if (index < 1 || !args[index + 1]) throw new BridgeFailure('invalid_arguments');
    const remaining = [...args.slice(1, index), ...args.slice(index + 2)];
    if (command === 'login-install' || command === 'login-status' || command === 'login-remove') {
      if (remaining.length !== 0) throw new BridgeFailure('invalid_arguments');
      io.out(JSON.stringify(await loginAction(command.slice(6) as 'install' | 'status' | 'remove', args[index + 1]!, loginEnvironment)));
      return 0;
    }
    let name: string | undefined;
    if (['capture', 'share-text'].includes(command!) && remaining[0] === '--name' && remaining.length === 2) name = remaining[1];
    else if (command === 'share-file') {
      if (!(remaining.length === 1 || (remaining.length === 3 && remaining[1] === '--name'))) throw new BridgeFailure('invalid_arguments');
      name = remaining.length === 3 ? remaining[2] : 'Context file';
      safeName(name!);
    }
    else if (!(command === 'revoke' && remaining.length === 1) && remaining.length !== 0) throw new BridgeFailure('invalid_arguments');
    if (!['start', 'stop', 'status', 'check-config', 'capture', 'share-text', 'share-file', 'list', 'revoke', 'clear'].includes(command!)) throw new BridgeFailure('invalid_arguments');
    const config = await loadConfig(args[index + 1]!);
    if (command === 'check-config') { io.out('Configuration schema valid. Provider, OAuth, tunnel, Dots and OS clipboard remain unverified.'); return 0; }
    const directory = await stateDirectory(config.stateDirectory);
    store = await ShareStore.open(directory, ownerId(config));
    const bridge = new ClipboardBridge(store, adapter);
    const print = (value: unknown) => io.out(JSON.stringify(value));
    switch (command) {
      case 'capture': print(await bridge.capture(name)); break;
      case 'share-file': print(store.captureFile(await readSelectedFile(remaining[0]!), name)); break;
      case 'share-text': {
        const chunks: Uint8Array[] = [];
        let size = 0;
        for await (const chunk of io.stdin) {
          size += chunk.byteLength;
          if (size > TEXT_LIMIT) throw new BridgeFailure('text_too_large');
          chunks.push(chunk);
        }
        print(store.capture(Buffer.concat(chunks), name ?? 'Shared text'));
        break;
      }
      case 'list': print(store.list()); break;
      case 'revoke': print({ revoked: store.revoke(remaining[0]!) }); break;
      case 'clear': print({ cleared: store.clear() }); break;
      case 'status': print({ ...await localControl(directory, 'status'), ...store.counts() }); break;
      case 'stop': print(await localControl(directory, 'stop')); break;
      case 'start': {
        const service = await startCompanion(config, makeVerifier(config), bridge);
        const stop = () => { void service.stop().catch(() => io.error('Companion stop failed.')); };
        process.once('SIGINT', stop); process.once('SIGTERM', stop);
        io.out('Explicit text bridge listening on IPv4 loopback. Live provider, tunnel, Dots and OS verification remain deferred.');
        try { await service.done; }
        finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
        break;
      }
    }
    return 0;
  } catch (error) {
    io.error(error instanceof BridgeFailure ? error.code : 'Operation failed. Check private configuration and state permissions.');
    return error instanceof BridgeFailure && error.code === 'invalid_arguments' ? 2 : 1;
  } finally { store?.close(); }
}
