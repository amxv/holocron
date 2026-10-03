import { resolve } from 'node:path';
import { runCli } from './cli-main.ts';
import type { CliIO } from './cli-main.ts';
import { runCloudCli } from './cloud-cli-main.ts';
import type { ClipboardAdapter } from './clipboard.ts';
import { macClipboard } from './clipboard.ts';
import { boardHome, initConfig, linkConfig, linkedConfig } from './board-profile.ts';
import { VERSION } from './version.ts';

const help = `Usage: board copy [--name <label>] [--local-config <absolute private JSON>]
       board share [--name <label>] [--local-config <absolute private JSON>]
       board share-file <selected UTF-8 file> [--name <label>] [--local-config <absolute private JSON>]
       board <list|status|clear|check-config|stdio> [--local-config <absolute private JSON>]
       board revoke <share ID> [--local-config <absolute private JSON>]
       board link --local-config <absolute private JSON>
       board init
       board cloud <probe|read|write --sha256 <digest> [--file <literal data file>]>
copy explicitly snapshots your Mac clipboard; share reads exact UTF-8 stdin to EOF.
Snapshots do not populate another computer's clipboard. Ask connected ChatGPT to read them;
explicit remote Wayland writes require the separately installed helper and original digest.
link saves only a private config reference; init creates a new private STDIO config, without starting anything.
Config selection: --local-config, then BOARD_LOCAL_CONFIG, then the saved link.
BOARD_CLI_HOME selects an absolute private profile directory (default ~/.config/board).
Management outputs one JSON metadata line. Exit 0 success, 1 operation failure, 2 invalid arguments.
Old shared-clipboard and OAuth HTTP commands remain available separately.`;

export async function runBoardCli(args: string[], io: CliIO, adapter: ClipboardAdapter = macClipboard(),
  options: { env?: NodeJS.ProcessEnv; selectedDirectory?: string; cloud?: typeof runCloudCli; signal?: AbortSignal } = {}): Promise<number> {
  if (args.length === 1 && args[0] === '--help') { io.out(help); return 0; }
  if (args.length === 1 && args[0] === '--version') { io.out(VERSION); return 0; }
  const command = args[0];
  if (command === 'cloud') {
    const cloudArgs = args.slice(1);
    const file = cloudArgs.indexOf('--file');
    if (file >= 0 && cloudArgs[file + 1]) cloudArgs[file + 1] = resolve(options.selectedDirectory ?? process.cwd(), cloudArgs[file + 1]!);
    return (options.cloud ?? runCloudCli)(cloudArgs, io, undefined, options.signal);
  }
  const env = options.env ?? process.env;
  const forwarded = args.slice(1);
  const indexes = forwarded.flatMap((arg, index) => arg === '--local-config' ? [index] : []);
  if (indexes.length > 1 || (indexes.length === 1 && !forwarded[indexes[0]! + 1])) {
    io.error('Invalid arguments. Run board --help.'); return 2;
  }
  const explicit = indexes.length ? forwarded.splice(indexes[0]!, 2)[1] : undefined;
  if (!['copy', 'share', 'share-file', 'list', 'status', 'clear', 'check-config', 'stdio', 'revoke', 'link', 'init'].includes(command ?? '') ||
      (command === 'link' && (!explicit || forwarded.length !== 0)) ||
      (command === 'init' && (args.length !== 1))) {
    io.error('Invalid arguments. Run board --help.'); return 2;
  }
  try {
    if (command === 'init') {
      await initConfig(await boardHome(env)); io.out(JSON.stringify({ initialized: true })); return 0;
    }
    if (command === 'link') {
      await linkConfig(await boardHome(env), explicit!); io.out(JSON.stringify({ linked: true })); return 0;
    }
    const config = explicit ?? env.BOARD_LOCAL_CONFIG ?? await linkedConfig(await boardHome(env));
    if (command === 'share-file' && forwarded[0] && !forwarded[0].startsWith('--')) {
      forwarded[0] = resolve(options.selectedDirectory ?? process.cwd(), forwarded[0]);
    }
    return await runCli([command === 'copy' ? 'capture' : command === 'share' ? 'share-text' : command!,
      ...forwarded, '--local-config', config], io, adapter);
  } catch {
    io.error('Board configuration unavailable or unsafe. Run board link --local-config /absolute/private/local.json, or board init for a new setup. Keep config mode 0600 and its parent mode 0700.');
    return 1;
  }
}
