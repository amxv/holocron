import { realpath, lstat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import nacl from 'tweetnacl';
import { currentUid, readPrivateConfig } from './private-state.ts';
import { encode, decode, tokenHash } from './secret-crypto.ts';
import { encoded, object, parseChannel, SecretFailure } from './secret-shapes.ts';
import type { SecretChannel } from './secret-shapes.ts';

export interface SecretPairing {
  version: 1; role: 'mac' | 'receiver'; relay: string; channel: SecretChannel; token: string;
  boxSecret?: string; signSecret?: string; prompt?: string;
}
export function relayUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      url.pathname !== '/api/secrets' || url.href !== value) throw new SecretFailure('invalid_relay');
  return value;
}
export async function promptExecutable(path: string): Promise<void> {
  if (!isAbsolute(path) || resolve(path) !== path || await realpath(path) !== path) throw new SecretFailure('unsafe_prompt');
  const info = await lstat(path);
  if (!info.isFile() || ![0, currentUid()].includes(info.uid) || (info.mode & 0o022) !== 0 || (info.mode & 0o111) === 0) {
    throw new SecretFailure('unsafe_prompt');
  }
}
export async function readPairing(path: string, role: 'mac' | 'receiver', allowExpired = false): Promise<SecretPairing> {
  const data = object(JSON.parse((await readPrivateConfig(path)).toString('utf8')),
    ['version', 'role', 'relay', 'channel', 'token', 'boxSecret', 'signSecret', 'prompt']);
  if (data.version !== 1 || data.role !== role || typeof data.relay !== 'string' || typeof data.token !== 'string') throw new SecretFailure('invalid_pairing');
  relayUrl(data.relay); encoded(data.token, 32);
  const expiry = (data.channel as { expiresAt?: unknown })?.expiresAt;
  const channel = parseChannel(data.channel, allowExpired && Number.isSafeInteger(expiry) && Number(expiry) <= Date.now() ? Number(expiry) - 1 : Date.now());
  if (tokenHash(data.token) !== (role === 'mac' ? channel.macTokenHash : channel.receiverTokenHash)) throw new SecretFailure('invalid_pairing');
  if (role === 'mac') {
    encoded(data.boxSecret, 32);
    if (data.signSecret !== undefined || typeof data.prompt !== 'string' ||
        encode(nacl.box.keyPair.fromSecretKey(decode(data.boxSecret)).publicKey) !== channel.macBoxPublic) throw new SecretFailure('invalid_pairing');
    await promptExecutable(data.prompt);
  } else {
    encoded(data.signSecret, 64);
    if (data.boxSecret !== undefined || data.prompt !== undefined ||
        encode(nacl.sign.keyPair.fromSecretKey(decode(data.signSecret)).publicKey) !== channel.receiverSignPublic) throw new SecretFailure('invalid_pairing');
  }
  return data as unknown as SecretPairing;
}
