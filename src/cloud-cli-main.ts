import { CloudClipboard } from './cloud-clipboard.ts';
import { boundedInput, cloudInputFile } from './cloud-input.ts';
import { requireDigest } from './digest.ts';
import { BridgeFailure } from './text.ts';
import { VERSION } from './version.ts';

const help = `Usage: holocron cloud probe
       holocron cloud read
       holocron cloud write --sha256 <exact lowercase SHA-256> [--file <literal data file>]
The holocron-cloud and legacy shared-clipboard-cloud executables accept the same arguments.
write reads literal UTF-8 stdin to EOF, or one already-created regular data file (no symlinks).
Linux Wayland only: /usr/bin/wl-copy and /usr/bin/wl-paste, named WAYLAND_DISPLAY and XDG_RUNTIME_DIR socket.
probe only checks prerequisites; it never reads or changes a clipboard and is not a viewed-desktop test.
read explicitly emits one bounded JSON text/byteCount/sha256 result. write verifies data before mutation,
then reads back to verify and prints an owned event, retaining foreground ownership until replacement,
SIGINT/SIGTERM, session loss or 30 minutes. Keep this process running to paste. No execution or keyboard events.
No provider/tunnel credentials, network, installation, clipboard watching or cached availability.
Actual Dots, provider/tunnel and viewed graphical clipboard compatibility remain unverified.
See docs/cloud-clipboard.md for exact transfer formats and digest chain.`;

export interface CloudIO {
  stdin: AsyncIterable<Uint8Array>;
  out(line: string): void;
  error(line: string): void;
}

export async function runCloudCli(args: string[], io: CloudIO, adapter = new CloudClipboard(), signal = new AbortController().signal): Promise<number> {
  if (args.length === 1 && args[0] === '--help') { io.out(help); return 0; }
  if (args.length === 1 && args[0] === '--version') { io.out(VERSION); return 0; }
  const emit = (result: Record<string, unknown>) => io.out(JSON.stringify(result));
  try {
    if (args.length === 1 && args[0] === 'probe') {
      const result = await adapter.probe(); emit({ ...result });
      return result.availability === 'candidate' ? 0 : 1;
    }
    if (args.length === 1 && args[0] === 'read') { emit(await adapter.read(signal)); return 0; }
    if (args[0] !== 'write' || args[1] !== '--sha256' || !args[2] ||
        !(args.length === 3 || (args.length === 5 && args[3] === '--file' && args[4]))) throw new BridgeFailure('invalid_arguments');
    requireDigest(args[2]);
    const bytes = args.length === 5 ? await cloudInputFile(args[4]!) : await boundedInput(io.stdin);
    const ended = await adapter.write(bytes, args[2], signal, emit);
    emit(ended);
    // Ownership loss is never a persistent publication claim. Normal replacement is the sole clean exit.
    return ended.reason === 'backend_released' ? 0 : 1;
  } catch (error) {
    io.error(JSON.stringify({ state: 'failed', code: error instanceof BridgeFailure ? error.code : 'cloud_operation_failed', viewedDesktop: 'unverified' }));
    return error instanceof BridgeFailure && error.code === 'invalid_arguments' ? 2 : 1;
  }
}
