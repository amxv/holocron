import { resolve } from 'node:path';
import { runCli } from './cli-main.ts';
import type { CliIO } from './cli-main.ts';
import { runCloudCli } from './cloud-cli-main.ts';
import type { ClipboardAdapter } from './clipboard.ts';
import { macClipboard } from './clipboard.ts';
import { holocronHome, initConfig, linkConfig, linkedConfig } from './holocron-profile.ts';
import { runSecretCli } from './secret-cli.ts';
import { VERSION } from './version.ts';

const help = `Usage: holocron copy [--name <label>] [--local-config <absolute private JSON>]
       holocron share [--name <label>] [--local-config <absolute private JSON>]
       holocron share-file <selected UTF-8 file> [--name <label>] [--local-config <absolute private JSON>]
       holocron <list|status|stop|clear|check-config|stdio> [--local-config <absolute private JSON>]
       holocron revoke <share ID> [--local-config <absolute private JSON>]
       holocron link --local-config <absolute private JSON>
       holocron init
       holocron ask --pairing-file <private receiver.json> -m <purpose> NAME [NAME...]
       holocron secrets --help
       holocron cloud <probe|read|write --sha256 <digest> [--file <literal data file>]>
       holocron <start|stop|status|check-config|capture|share-text|share-file|list|revoke|clear> --config <private HTTP JSON>
       holocron <login-install|login-status|login-remove> --config <private HTTP JSON>
       holocron prepare-plugin --connection-id <registered ID> --output <new directory>
copy explicitly snapshots your Mac clipboard; share reads exact UTF-8 stdin to EOF.
Snapshots do not populate another computer's clipboard. Ask connected ChatGPT to read them;
explicit remote Wayland writes require the separately installed helper and original digest.
link saves only a private config reference; init creates a new private STDIO config, without starting anything.
Config selection: --local-config, HOLOCRON_LOCAL_CONFIG, BOARD_LOCAL_CONFIG, then the saved link.
HOLOCRON_CLI_HOME (or legacy BOARD_CLI_HOME) selects an absolute private profile directory.
New profiles use ~/.config/holocron; an existing ~/.config/board profile is reused in place.
Management outputs one JSON metadata line. Exit 0 success, 1 operation failure, 2 invalid arguments.
Legacy board/shared-clipboard commands, owner IDs and existing state remain compatible.`;

export async function runHolocronCli(args: string[], io: CliIO, adapter: ClipboardAdapter = macClipboard(),
  options: { env?: NodeJS.ProcessEnv; selectedDirectory?: string; cloud?: typeof runCloudCli; signal?: AbortSignal } = {}): Promise<number> {
  if (args.length === 1 && args[0] === '--help') { io.out(help); return 0; }
  if (args.length === 1 && args[0] === '--version') { io.out(VERSION); return 0; }
  const command = args[0];
  if (command === 'ask' || command === 'secrets') {
    return runSecretCli(command === 'ask' ? args : args.slice(1), io, options.signal ?? new AbortController().signal);
  }
  if (command === 'cloud') {
    const cloudArgs = args.slice(1);
    const file = cloudArgs.indexOf('--file');
    if (file >= 0 && cloudArgs[file + 1]) cloudArgs[file + 1] = resolve(options.selectedDirectory ?? process.cwd(), cloudArgs[file + 1]!);
    return (options.cloud ?? runCloudCli)(cloudArgs, io, undefined, options.signal);
  }
  const env = options.env ?? process.env;
  if (args.includes('--config') || command === 'prepare-plugin' || command?.startsWith('login-')) {
    const direct = args.slice();
    if (command === 'copy') direct[0] = 'capture';
    if (command === 'share') direct[0] = 'share-text';
    if (command === 'share-file' && direct[1] && !direct[1].startsWith('--')) {
      direct[1] = resolve(options.selectedDirectory ?? process.cwd(), direct[1]);
    }
    return runCli(direct, io, adapter);
  }
  const forwarded = args.slice(1);
  const indexes = forwarded.flatMap((arg, index) => arg === '--local-config' ? [index] : []);
  if (indexes.length > 1 || (indexes.length === 1 && !forwarded[indexes[0]! + 1])) {
    io.error('Invalid arguments. Run holocron --help.'); return 2;
  }
  const explicit = indexes.length ? forwarded.splice(indexes[0]!, 2)[1] : undefined;
  if (!['copy', 'share', 'capture', 'share-text', 'share-file', 'list', 'status', 'stop', 'clear', 'check-config', 'stdio', 'revoke', 'link', 'init'].includes(command ?? '') ||
      (command === 'link' && (!explicit || forwarded.length !== 0)) ||
      (command === 'init' && (args.length !== 1))) {
    io.error('Invalid arguments. Run holocron --help.'); return 2;
  }
  try {
    if (command === 'init') {
      await initConfig(await holocronHome(env)); io.out(JSON.stringify({ initialized: true })); return 0;
    }
    if (command === 'link') {
      await linkConfig(await holocronHome(env), explicit!); io.out(JSON.stringify({ linked: true })); return 0;
    }
    const config = explicit ?? env.HOLOCRON_LOCAL_CONFIG ?? env.BOARD_LOCAL_CONFIG ?? await linkedConfig(await holocronHome(env));
    if (command === 'share-file' && forwarded[0] && !forwarded[0].startsWith('--')) {
      forwarded[0] = resolve(options.selectedDirectory ?? process.cwd(), forwarded[0]);
    }
    return await runCli([command === 'copy' ? 'capture' : command === 'share' ? 'share-text' : command!,
      ...forwarded, '--local-config', config], io, adapter);
  } catch {
    io.error('Holocron configuration unavailable or unsafe. Run holocron link --local-config /absolute/private/local.json, or holocron init for a new setup. Keep config mode 0600 and its parent mode 0700.');
    return 1;
  }
}
