import { randomBytes } from 'node:crypto';
import { holocronHome } from './holocron-profile.ts';
import { readPairing } from './secret-pairing.ts';
import type { SecretPairing } from './secret-pairing.ts';
import { relayClient } from './secret-client.ts';
import type { RelayCall } from './secret-client.ts';
import { idPattern, parseEnvelope, SecretFailure } from './secret-shapes.ts';
import { readSetup } from './setup-profile.ts';
import { decodePairedText, encodePairedText, PAIRED_TEXT_TTL_MS } from './paired-text-wire.ts';

export interface PairedPeer { peerId: string; name: string; expiresAt: string }
export interface PairedTextEntry { id: string; peerId: string; from: string; sentAt: string; expiresAt: string }
type CallFactory = (pairing: SecretPairing) => RelayCall;

export class PairedTextService {
  private readonly pairings: SecretPairing[];
  private readonly callFactory: CallFactory;
  constructor(pairings: SecretPairing[], callFactory: CallFactory = relayClient) {
    this.pairings = pairings; this.callFactory = callFactory;
  }
  peers(): PairedPeer[] {
    return this.pairings.map(p => ({ peerId: p.channel.channel, name: p.role === 'mac' ? p.channel.recipient : 'Mac',
      expiresAt: new Date(p.channel.expiresAt).toISOString() }));
  }
  private select(id?: string): SecretPairing {
    if (id !== undefined) {
      const pairing = this.pairings.find(p => p.channel.channel === id);
      if (!pairing) throw new SecretFailure('peer_unavailable');
      return pairing;
    }
    if (this.pairings.length !== 1) throw new SecretFailure(this.pairings.length ? 'peer_required' : 'not_paired');
    return this.pairings[0]!;
  }
  async send(text: string, name = 'Shared text', peerId?: string, signal?: AbortSignal) {
    const pair = this.select(peerId);
    const id = randomBytes(16).toString('hex');
    const envelope = encodePairedText(pair, id, name, text);
    const expiresAt = Math.min(Date.now() + PAIRED_TEXT_TTL_MS, pair.channel.expiresAt);
    if (expiresAt <= Date.now()) throw new SecretFailure('pairing_expired');
    const response = await this.callFactory(pair)('text-send', { id, expiresAt, envelope }, signal);
    if (response.ok !== true || response.id !== id || response.expiresAt !== expiresAt || !Number.isSafeInteger(response.sentAt)) {
      throw new SecretFailure('invalid_relay_response');
    }
    return { id, peerId: pair.channel.channel, name, byteCount: Buffer.byteLength(text),
      sentAt: new Date(Number(response.sentAt)).toISOString(), expiresAt: new Date(expiresAt).toISOString() };
  }
  async inbox(peerId?: string, signal?: AbortSignal): Promise<{ items: PairedTextEntry[] }> {
    const pairings = peerId ? [this.select(peerId)] : this.pairings;
    if (!pairings.length) throw new SecretFailure('not_paired');
    const lists = await Promise.all(pairings.map(async pair => {
      const response = await this.callFactory(pair)('text-list', {}, signal);
      if (!Array.isArray(response.items) || response.items.length > 100) throw new SecretFailure('invalid_relay_response');
      return response.items.map((entry: unknown) => {
        const value = entry as Record<string, unknown>;
        if (!value || typeof value.id !== 'string' || !idPattern.test(value.id) ||
            !Number.isSafeInteger(value.sentAt) || !Number.isSafeInteger(value.expiresAt)) throw new SecretFailure('invalid_relay_response');
        return { id: value.id, peerId: pair.channel.channel, from: pair.role === 'mac' ? pair.channel.recipient : 'Mac',
          sentAt: new Date(Number(value.sentAt)).toISOString(), expiresAt: new Date(Number(value.expiresAt)).toISOString() };
      });
    }));
    return { items: lists.flat().sort((a, b) => b.sentAt.localeCompare(a.sentAt)) };
  }
  async read(id: string, peerId?: string, signal?: AbortSignal) {
    if (!idPattern.test(id)) throw new SecretFailure('invalid_message_id');
    const pair = this.select(peerId);
    const response = await this.callFactory(pair)('text-read', { id }, signal);
    if (response.id !== id || !Number.isSafeInteger(response.sentAt) || !Number.isSafeInteger(response.expiresAt)) {
      throw new SecretFailure('invalid_relay_response');
    }
    const decoded = decodePairedText(pair, id, parseEnvelope(response.envelope));
    return { id, peerId: pair.channel.channel, from: pair.role === 'mac' ? pair.channel.recipient : 'Mac',
      sentAt: new Date(Number(response.sentAt)).toISOString(), expiresAt: new Date(Number(response.expiresAt)).toISOString(), ...decoded };
  }
  async remove(id: string, peerId?: string, signal?: AbortSignal) {
    if (!idPattern.test(id)) throw new SecretFailure('invalid_message_id');
    const pair = this.select(peerId);
    const response = await this.callFactory(pair)('text-delete', { id }, signal);
    if (response.deleted !== true) throw new SecretFailure('invalid_relay_response');
    return { deleted: true, id, peerId: pair.channel.channel };
  }
}

export async function loadPairedText(env = process.env, receiverFile?: string): Promise<PairedTextService> {
  if (receiverFile) return new PairedTextService([await readPairing(receiverFile, 'receiver')]);
  const setup = await readSetup(await holocronHome(env));
  const saved = setup.role === 'mac' ? setup.macConfigs : setup.receiverConfig ? [setup.receiverConfig] : [];
  const pairings = await Promise.all(saved.map(path => readPairing(path, setup.role, true)));
  return new PairedTextService(pairings.filter(p => p.channel.expiresAt > Date.now()));
}

export async function optionalPairedText(localConfig: string, env = process.env): Promise<PairedTextService | undefined> {
  try {
    const setup = await readSetup(await holocronHome(env));
    if (setup.role !== 'mac' || setup.localConfig !== localConfig) return undefined;
    const service = await loadPairedText(env);
    return service.peers().length ? service : undefined;
  } catch {
    // This is an optional extension to the existing Mac snapshot MCP. A stale,
    // revoked or broken paired setup must not disable the older local bridge.
    // Failing closed means no paired text tools are registered in that case.
    return undefined;
  }
}
