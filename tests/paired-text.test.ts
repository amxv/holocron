import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import nacl from 'tweetnacl';
import { pairings, isolatedRedis } from './secret-fixtures.ts';
import { encode } from '../src/secret-crypto.ts';
import { secretRelay } from '../src/secret-relay.ts';
import { relayClient } from '../src/secret-client.ts';
import { PairedTextService } from '../src/paired-text.ts';
import { decodePairedText, encodePairedText, PAIRED_TEXT_LIMIT, PAIRED_TEXT_TTL_MS } from '../src/paired-text-wire.ts';

test('legacy Ed25519 receiver pairing supports encrypted authenticated snippets in BOTH directions', () => {
  const p = pairings(); const id = 'b'.repeat(32); const text = '\ufeffLiteral\n雪🚀\r\n$()';
  for (const [sender, recipient] of [[p.mac, p.receiver], [p.receiver, p.mac]] as const) {
    const envelope = encodePairedText(sender, id, 'Friendly note', text);
    assert.equal(JSON.stringify(envelope).includes(text), false);
    assert.deepEqual(decodePairedText(recipient, id, envelope), {
      name: 'Friendly note', text, byteCount: Buffer.byteLength(text),
      sha256: createHash('sha256').update(text).digest('hex'),
    });
    assert.throws(() => decodePairedText(sender, id, envelope), /invalid_paired_text/);
    assert.throws(() => decodePairedText(recipient, 'a'.repeat(32), envelope), /invalid_paired_text/);
    assert.throws(() => decodePairedText(recipient, id, { ...envelope, ciphertext: encode(nacl.randomBytes(128)) }), /message_authentication_failed/);
  }
  assert.throws(() => encodePairedText(p.mac, id, 'label', 'x'.repeat(PAIRED_TEXT_LIMIT + 1)), /invalid_text/);
  assert.throws(() => encodePairedText(p.mac, id, 'label', '\ud800'), /invalid_text/);
  assert.throws(() => encodePairedText(p.mac, id, '../bad', 'test'), /invalid_display_name/);
});

test('isolated relay isolates direction, stores ciphertext, enforces inbox access, replay, deletion and revocation', async (t) => {
  const redis = await isolatedRedis(t); const fixture = pairings(); const admin = encode(nacl.randomBytes(32));
  let offset = 0; const handler = secretRelay(redis, admin, () => Date.now() + offset);
  const observed: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    observed.push(String(init?.body));
    const reply = await handler(new Request(String(url), init));
    observed.push(await reply.clone().text());
    return reply;
  };
  const factory = (pair: typeof fixture.mac) => relayClient(pair, fetcher);
  const mac = new PairedTextService([fixture.mac], factory);
  const receiver = new PairedTextService([fixture.receiver], factory);
  const directMac = factory(fixture.mac); const directReceiver = factory(fixture.receiver);
  await relayClient({ ...fixture.mac, token: admin }, fetcher)('provision', fixture.mac.channel);
  const text = '\ufeffAn agent sent this\n雪🚀\n';
  const inbound = await receiver.send(text, 'From Linux');
  const prefix = 'board-secret-v1:' + fixture.mac.channel.channel;
  const stored = await redis.command(['GET', prefix + ':message:mac:' + inbound.id]);
  assert.equal(stored.includes(text), false);
  assert.equal(observed.join('\n').includes(text), false);
  assert.equal((await mac.inbox()).items[0]!.id, inbound.id);
  assert.equal((await receiver.inbox()).items.length, 0);
  assert.deepEqual((await mac.read(inbound.id)).text, text);
  assert.equal((await mac.read(inbound.id)).name, 'From Linux'); // Non-consuming reads.
  await assert.rejects(receiver.read(inbound.id), /message_unavailable/);

  const outbound = await mac.send('Mac to Linux\r\n', 'Mac note');
  assert.equal((await receiver.read(outbound.id)).text, 'Mac to Linux\r\n');
  await assert.rejects(mac.read(outbound.id), /message_unavailable/);
  assert.deepEqual(await receiver.remove(outbound.id), { deleted: true, id: outbound.id, peerId: outbound.peerId });
  await assert.rejects(receiver.read(outbound.id), /message_unavailable/);
  await assert.rejects(receiver.remove(outbound.id), /message_unavailable/);

  const invalidToken = relayClient({ ...fixture.mac, token: encode(nacl.randomBytes(32)) }, fetcher);
  await assert.rejects(invalidToken('text-list', {}), /unauthorized/);
  const forgedId = 'c'.repeat(32);
  const forged = encodePairedText(fixture.mac, forgedId, 'Forged direction', 'text');
  await directReceiver('text-send', { id: forgedId, expiresAt: Date.now() + 30_000, envelope: forged });
  await assert.rejects(mac.read(forgedId), /invalid_paired_text/);
  await assert.rejects(directReceiver('text-send', { id: forgedId, expiresAt: Date.now() + 30_000, envelope: forged }), /message_replayed/);
  await assert.rejects(directReceiver('text-send', { id: 'd'.repeat(32), expiresAt: Date.now() + PAIRED_TEXT_TTL_MS + 5000, envelope: forged }), /relay_unavailable/);
  await assert.rejects(directReceiver('text-delete', { id: inbound.id }), /message_unavailable/);
  await assert.rejects(directMac('text-read', { id: outbound.id }), /message_unavailable/);

  offset = PAIRED_TEXT_TTL_MS + 10;
  assert.deepEqual(await mac.inbox(), { items: [] });
  await assert.rejects(mac.read(inbound.id), /message_unavailable/);
  offset = 0;
  await directMac('revoke', {});
  await assert.rejects(receiver.inbox(), /unauthorized/);
  await assert.rejects(mac.inbox(), /unauthorized/);
});
