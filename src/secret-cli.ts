import { isAbsolute, join } from 'node:path';
import { readPrivateConfig } from './private-state.ts';
import { readPairing } from './secret-pairing.ts';
import { prepareReceiver, pairReceiver, completeReceiver } from './secret-enrollment.ts';
import { removeSecretFiles } from './secret-files.ts';
import { relayClient } from './secret-client.ts';
import { askSecrets, serveSecrets } from './secret-workflow.ts';
import { fingerprint } from './secret-crypto.ts';
import { SecretFailure } from './secret-shapes.ts';
import type { CliIO } from './cli-main.ts';
import { buildSecretPrompt } from './secret-prompt-build.ts';
import { savedReceiver } from './setup-profile.ts';

const help = `Usage: holocron ask [--pairing-file <absolute private receiver.json>] -m <non-secret purpose> NAME [NAME...]
       holocron setup receiver --code CODE
       holocron setup | pair | start | stop | status
       holocron secrets prepare --directory <new private directory> --relay <https://host/api/secrets> --recipient <label>
       holocron secrets pair --directory <new private directory> --descriptor-file <public descriptor staged privately> --receiver-fingerprint <verified public fingerprint> --prompt <absolute AppKit helper> --admin-file <private token file>
       holocron secrets complete --pending-file <private pending.json> --enrollment-file <encrypted enrollment staged privately> --mac-fingerprint <verified public fingerprint>
       holocron secrets build-prompt --directory <new absolute private directory>
       holocron secrets provision --mac-config <absolute private mac.json> --admin-file <absolute private token file>
       holocron secrets serve --mac-config <absolute private mac.json>
       holocron secrets revoke --mac-config <absolute private mac.json>
       holocron secrets cleanup --directory <private temporary session directory>
ask runs on the requester and prints only its private temporary directory path; files auto-delete after five minutes.
The human approves named secrets in the Mac's native prompt. Request expiry is fifteen minutes; Ctrl+C cancels.
Receiver credentials are generated and stay on that computer. ask selects the saved receiver unless an explicit file is supplied.
Code pairing uses a fifteen-minute public code plus eight digits entered in the native Mac prompt. Pairing lasts seven days.
Legacy file pairing requires independently compared fingerprints; exchange only descriptor.json and encrypted enrollment.json.
serve is a separate foreground Mac process; it polls every 30 seconds when idle and never changes the tunnel.
Requires a dedicated encrypted relay; an MCP connection alone cannot deliver requester files.
Purpose, names and recipient labels are non-secret metadata. Never place key values in arguments.
See docs/secret-requests.md. No clipboard capture or arbitrary remote command/file access.`;

function flags(args: string[], expected: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (args.length !== expected.length * 2) throw new SecretFailure('invalid_arguments');
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i]!; const value = args[i + 1];
    if (!expected.includes(name) || !value || out[name] !== undefined) throw new SecretFailure('invalid_arguments');
    out[name] = value;
  }
  return out;
}
export async function runSecretCli(args: string[], io: CliIO, signal: AbortSignal, env = process.env): Promise<number> {
  if ((args.length === 1 && args[0] === '--help') || (args.length === 2 && args[0] === 'ask' && args[1] === '--help')) { io.out(help); return 0; }
  try {
    if (args[0] === 'ask') {
      const explicit = args[1] === '--pairing-file'; const purpose = explicit ? 3 : 1;
      if (args[purpose] !== '-m' || !args[purpose + 1] || args.length < purpose + 3 || explicit && !args[2]) throw new SecretFailure('invalid_arguments');
      const pairing = await readPairing(explicit ? args[2]! : await savedReceiver(env), 'receiver');
      const directory = await askSecrets(pairing, args.slice(purpose + 2), args[purpose + 1]!, signal);
      io.out(directory); return 0;
    }
    if (args[0] === 'build-prompt') {
      const f = flags(args.slice(1), ['--directory']); io.out(await buildSecretPrompt(f['--directory']!, signal)); return 0;
    }
    if (args[0] === 'prepare') {
      const f = flags(args.slice(1), ['--directory', '--relay', '--recipient']);
      io.out(JSON.stringify(await prepareReceiver(f['--directory']!, f['--relay']!, f['--recipient']!))); return 0;
    }
    if (args[0] === 'pair') {
      const f = flags(args.slice(1), ['--directory', '--descriptor-file', '--receiver-fingerprint', '--prompt', '--admin-file']);
      io.out(JSON.stringify(await pairReceiver({ directory: f['--directory']!, descriptorFile: f['--descriptor-file']!,
        receiverFingerprint: f['--receiver-fingerprint']!, prompt: f['--prompt']!, adminFile: f['--admin-file']! }, signal))); return 0;
    }
    if (args[0] === 'complete') {
      const f = flags(args.slice(1), ['--pending-file', '--enrollment-file', '--mac-fingerprint']);
      io.out(JSON.stringify(await completeReceiver(f['--pending-file']!, f['--enrollment-file']!, f['--mac-fingerprint']!))); return 0;
    }
    if (args[0] === 'cleanup') {
      const f = flags(args.slice(1), ['--directory']);
      const expiry = Number((await readPrivateConfig(join(f['--directory']!, '.expires'))).toString('utf8'));
      await removeSecretFiles(f['--directory']!, expiry); io.out('{"cleaned":true}'); return 0;
    }
    if (!['provision', 'serve', 'revoke'].includes(args[0] ?? '')) throw new SecretFailure('invalid_arguments');
    const f = flags(args.slice(1), args[0] === 'provision' ? ['--mac-config', '--admin-file'] : ['--mac-config']);
    const pairing = await readPairing(f['--mac-config']!, 'mac');
    if (args[0] === 'provision') {
      if (!isAbsolute(f['--admin-file']!)) throw new SecretFailure('invalid_arguments');
      const token = (await readPrivateConfig(f['--admin-file']!)).toString('utf8').trim();
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new SecretFailure('invalid_admin_file');
      const result = await relayClient({ ...pairing, token })('provision', pairing.channel, signal);
      if (result.ok !== true) throw new SecretFailure('invalid_relay_response');
      io.out(JSON.stringify({ provisioned: true, recipient: pairing.channel.recipient, fingerprint: fingerprint(pairing.channel.receiverSignPublic) })); return 0;
    }
    if (args[0] === 'revoke') {
      const result = await relayClient(pairing)('revoke', {}, signal);
      if (result.ok !== true) throw new SecretFailure('invalid_relay_response');
      io.out('{"revoked":true}'); return 0;
    }
    io.out(JSON.stringify({ ready: true, recipient: pairing.channel.recipient, fingerprint: fingerprint(pairing.channel.receiverSignPublic) }));
    await serveSecrets(pairing, signal); return 0;
  } catch (error) {
    if (signal.aborted) { io.error('request_cancelled'); return 1; }
    io.error(error instanceof SecretFailure ? error.code : 'secret_operation_failed');
    return error instanceof SecretFailure && error.code === 'invalid_arguments' ? 2 : 1;
  }
}
