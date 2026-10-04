import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { join, dirname } from 'node:path';
import type { TestContext } from 'node:test';
import nacl from 'tweetnacl';
import { temporary } from './bridge-fixtures.ts';
import { encode, tokenHash, signRequest } from '../src/secret-crypto.ts';
import { PAIRING_MS } from '../src/secret-shapes.ts';
import type { SecretPairing } from '../src/secret-pairing.ts';
import type { SecretRedis } from '../src/secret-relay.ts';

export const canary = '\ufeffsynthetic-key-雪-`quotes`-$()-\r\ntrailing\n';
export function pairings() {
  const macKey = nacl.box.keyPair(); const signKey = nacl.sign.keyPair(); const receiverKey = nacl.box.keyPair();
  const macToken = encode(nacl.randomBytes(32)); const receiverToken = encode(nacl.randomBytes(32));
  const channel = { version: 1 as const, channel: Buffer.from(nacl.randomBytes(16)).toString('hex'), expiresAt: Date.now() + PAIRING_MS - 1000,
    recipient: 'Isolated requester', macTokenHash: tokenHash(macToken), receiverTokenHash: tokenHash(receiverToken),
    receiverSignPublic: encode(signKey.publicKey), macBoxPublic: encode(macKey.publicKey) };
  const mac: SecretPairing = { version: 1, role: 'mac', relay: 'https://holocron.invalid/api/secrets', channel, token: macToken, boxSecret: encode(macKey.secretKey), prompt: '/private/example/helper' };
  const receiver: SecretPairing = { version: 1, role: 'receiver', relay: mac.relay, channel, token: receiverToken, signSecret: encode(signKey.secretKey) };
  const request = signRequest({ version: 1, channel: channel.channel, id: Buffer.from(nacl.randomBytes(16)).toString('hex'), expiresAt: Date.now() + 120_000,
    names: ['API_KEY'], purpose: 'Configure the requested test application', receiverPublic: encode(receiverKey.publicKey) }, receiver.signSecret!);
  return { mac, receiver, receiverKey, request };
}

export async function isolatedRedis(t: TestContext): Promise<SecretRedis & { command(args: string[]): Promise<string> }> {
  const executable = process.env.HOLOCRON_TEST_REDIS_SERVER;
  if (!executable) throw new Error('HOLOCRON_TEST_REDIS_SERVER must name an installed redis-server for the isolated relay security gate');
  const directory = await temporary(t); const socket = join(directory, 'redis.sock');
  const processHandle = spawn(executable, ['--port', '0', '--unixsocket', socket, '--unixsocketperm', '700', '--save', '', '--appendonly', 'no', '--dir', directory], {
    stdio: ['ignore', 'pipe', 'ignore'], env: { PATH: '/usr/bin:/bin' },
  });
  const ended = once(processHandle, 'exit');
  t.after(async () => { processHandle.kill('SIGTERM'); await ended; });
  await new Promise<void>((accept, reject) => {
    const timeout = setTimeout(() => reject(new Error('isolated Redis readiness failed')), 5000);
    processHandle.once('error', reject);
    processHandle.once('exit', () => reject(new Error('isolated Redis exited before readiness')));
    processHandle.stdout.on('data', (bytes: Buffer) => {
      if (/ready to accept connections/i.test(bytes.toString())) { clearTimeout(timeout); accept(); }
    });
  });
  const run = promisify(execFile); const cli = join(dirname(executable), 'redis-cli');
  const command = async (args: string[]) => (await run(cli, ['-s', socket, '--raw', ...args], { maxBuffer: 4 * 1024 * 1024 })).stdout.trimEnd();
  return { command, async eval(script, keys, args) { return command(['EVAL', script, String(keys.length), ...keys, ...args.map(String)]); } };
}
