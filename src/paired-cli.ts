import type { CliIO } from './cli-main.ts';
import { loadPairedText } from './paired-text.ts';
import { PAIRED_TEXT_LIMIT } from './paired-text-wire.ts';
import { SecretFailure } from './secret-shapes.ts';

const help = [
  'Usage: holocron peers',
  "       printf 'text' | holocron send [--peer PEER_ID] [--name LABEL]",
  '       holocron inbox [--peer PEER_ID]',
  '       holocron read MESSAGE_ID [--peer PEER_ID]',
  '       holocron delete MESSAGE_ID [--peer PEER_ID]',
  '       holocron paired-mcp',
  'Paired messages are end-to-end encrypted, kept up to 24 hours and never touch clipboards.',
  'A saved receiver needs no --peer. On a Mac with multiple pairings, send/read/delete require --peer.',
  'Use --pairing-file ABS_RECEIVER_JSON to select an existing receiver pairing instead of saved setup.',
  'The relay stores ciphertext only. Read prints literal received text inside a JSON response.',
].join('\n');

function parse(args: string[]): { positional: string[]; peer?: string; pairingFile?: string; name?: string } {
  const positional: string[] = []; const result: { positional: string[]; peer?: string; pairingFile?: string; name?: string } = { positional };
  for (let i = 0; i < args.length; i++) {
    const part = args[i]!;
    if (!['--peer', '--pairing-file', '--name'].includes(part)) { positional.push(part); continue; }
    const value = args[++i];
    if (!value || value.startsWith('--') || part === '--peer' && result.peer ||
        part === '--pairing-file' && result.pairingFile || part === '--name' && result.name) throw new SecretFailure('invalid_arguments');
    if (part === '--peer') result.peer = value;
    if (part === '--pairing-file') result.pairingFile = value;
    if (part === '--name') result.name = value;
  }
  return result;
}

export async function runPairedCli(args: string[], io: CliIO, signal: AbortSignal, env = process.env): Promise<number> {
  if (args.length === 1 && args[0] === '--help') { io.out(help); return 0; }
  try {
    const command = args[0]; const { positional, peer, pairingFile, name } = parse(args.slice(1));
    if (!['peers', 'send', 'inbox', 'read', 'delete'].includes(command ?? '') ||
        (['peers', 'send', 'inbox'].includes(command!) && positional.length !== 0) ||
        (['read', 'delete'].includes(command!) && positional.length !== 1) ||
        (name !== undefined && command !== 'send') || (peer !== undefined && command === 'peers')) throw new SecretFailure('invalid_arguments');
    const service = await loadPairedText(env, pairingFile);
    let output: unknown;
    if (command === 'peers') output = { peers: service.peers() };
    else if (command === 'send') {
      let count = 0; const chunks: Uint8Array[] = [];
      for await (const chunk of io.stdin) {
        count += chunk.byteLength;
        if (count > PAIRED_TEXT_LIMIT) throw new SecretFailure('text_too_large');
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { throw new SecretFailure('invalid_utf8'); }
      output = await service.send(text, name, peer, signal);
    } else if (command === 'inbox') output = await service.inbox(peer, signal);
    else if (command === 'read') output = await service.read(positional[0]!, peer, signal);
    else output = await service.remove(positional[0]!, peer, signal);
    io.out(JSON.stringify(output)); return 0;
  } catch (error) {
    io.error(signal.aborted ? 'operation_cancelled' : error instanceof SecretFailure ? error.code : 'paired_text_failed');
    return error instanceof SecretFailure && error.code === 'invalid_arguments' ? 2 : 1;
  }
}
