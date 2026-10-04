import { createHash, timingSafeEqual } from 'node:crypto';
import { encoded, hashPattern, object, parseEnvelope, SecretFailure, PAIRING_CODE_MS } from './secret-shapes.ts';
import type { SecretRedis } from './secret-relay.ts';

// Public commitments/reveals and encrypted enrollment only. Owner/receiver session
// bearers are separate from channel credentials. One proposal, no reset, fixed TTL.
export const codeRelayScript = `
local action=ARGV[1]
local now=tonumber(ARGV[2])
local token=ARGV[3]
local data=cjson.decode(ARGV[4])
local rate=redis.call('INCR',KEYS[3])
if rate==1 then redis.call('PEXPIRE',KEYS[3],60000) end
if rate>600 then return '{"error":"rate_limited"}' end
if action=='code-open' then
  if redis.call('EXISTS',KEYS[2])==1 then return '{"error":"pairing_code_used"}' end
  redis.call('SET',KEYS[2],'1','PX',${PAIRING_CODE_MS})
  redis.call('SET',KEYS[1],cjson.encode({offer=data.offer,owner=data.ownerTokenHash,state='open'}),'PX',data.offer.expiresAt-now)
  return '{"ok":true}'
end
local raw=redis.call('GET',KEYS[1])
if not raw then return '{"error":"pairing_code_expired_or_invalid"}' end
local s=cjson.decode(raw)
if s.offer.expiresAt<=now then return '{"error":"pairing_code_expired_or_invalid"}' end
local owner=token==s.owner
local receiver=s.receiver and token==s.receiver
if action=='code-peek' then return cjson.encode({offer=s.offer}) end
if action=='code-commit' then
  if s.state~='open' then return '{"error":"pairing_code_used"}' end
  s.state='committed'; s.commit=data; s.receiver=token
elseif action=='code-reveal-mac' then
  if not owner or s.state~='committed' then return '{"error":"pairing_code_used"}' end
  s.state='mac-revealed'; s.mac=data
elseif action=='code-reveal-receiver' then
  if not receiver or s.state~='mac-revealed' then return '{"error":"pairing_code_used"}' end
  s.state='receiver-revealed'; s.reveal=data
elseif action=='code-deliver' then
  if not owner or s.state~='receiver-revealed' then return '{"error":"pairing_code_used"}' end
  s.state='delivered'; s.enrollment=data
elseif action=='code-cancel' then
  if not owner and not receiver then return '{"error":"unauthorized"}' end
  s.state='cancelled'; s.enrollment=nil
elseif action=='code-poll' then
  if not owner and not receiver then return '{"error":"unauthorized"}' end
  local out={state=s.state,offer=s.offer,commit=s.commit,mac=s.mac,reveal=s.reveal}
  if receiver and s.state=='delivered' then
    out.enrollment=s.enrollment; s.enrollment=nil; s.state='consumed'
    redis.call('SET',KEYS[1],cjson.encode(s),'KEEPTTL')
  end
  return cjson.encode(out)
else return '{"error":"invalid_arguments"}' end
redis.call('SET',KEYS[1],cjson.encode(s),'KEEPTTL')
return '{"ok":true}'
`;
const digest = (v: string) => createHash('sha256').update(v).digest();
export async function codeRelay(redis: SecretRedis, admin: string, action: string, code: unknown, value: unknown, token: string, now: number) {
  if (typeof code !== 'string' || !/^[A-Z2-7]{20}$/.test(code)) throw new SecretFailure('invalid_arguments');
  let data: unknown;
  if (action === 'code-open') {
    if (!/^[A-Za-z0-9_-]{43}$/.test(admin) || !timingSafeEqual(digest(token), digest(admin))) return { error: 'unauthorized' };
    const d = object(value, ['offer', 'ownerTokenHash']); const offer = object(d.offer, ['version', 'code', 'commitment', 'expiresAt']);
    if (offer.version !== 1 || offer.code !== code || typeof offer.commitment !== 'string' || !hashPattern.test(offer.commitment) ||
        !Number.isSafeInteger(offer.expiresAt) || Number(offer.expiresAt) <= now || Number(offer.expiresAt) > now + PAIRING_CODE_MS ||
        typeof d.ownerTokenHash !== 'string' || !hashPattern.test(d.ownerTokenHash)) throw new SecretFailure('invalid_arguments');
    data = d;
  } else if (action === 'code-commit') {
    const d = object(value, ['commitment', 'receiverTokenHash']);
    if (typeof d.commitment !== 'string' || !hashPattern.test(d.commitment) || d.receiverTokenHash !== digest(token).toString('hex')) throw new SecretFailure('invalid_arguments');
    data = d;
  } else if (action === 'code-reveal-mac') {
    const d = object(value, ['nonce', 'macBoxPublic']); encoded(d.nonce, 32); encoded(d.macBoxPublic, 32); data = d;
  } else if (action === 'code-reveal-receiver') {
    const d = object(value, ['nonce', 'descriptor']); encoded(d.nonce, 32);
    const descriptor = object(d.descriptor, ['version', 'relay', 'channel', 'expiresAt', 'recipient', 'receiverSignPublic', 'enrollmentPublic', 'receiverTokenHash', 'signature']);
    // Endpoint clients authenticate the complete descriptor; the relay never asserts identity.
    encoded(descriptor.signature, 64); encoded(descriptor.enrollmentPublic, 32); encoded(descriptor.receiverSignPublic, 32); data = d;
  } else if (action === 'code-deliver') {
    const d = object(value, ['version', 'descriptorFingerprint', 'macBoxPublic', 'envelope']);
    if (d.version !== 1 || typeof d.descriptorFingerprint !== 'string' || !hashPattern.test(d.descriptorFingerprint)) throw new SecretFailure('invalid_arguments');
    encoded(d.macBoxPublic, 32); parseEnvelope(d.envelope); data = d;
  } else if (['code-peek', 'code-poll', 'code-cancel'].includes(action)) { object(value, []); data = {}; }
  else throw new SecretFailure('invalid_arguments');
  const prefix = `holocron-code-v1:${code}`;
  const result = await redis.eval(codeRelayScript, [prefix, `${prefix}:used`, 'holocron-code-v1:global-rate'], [action, now, digest(token).toString('hex'), JSON.stringify(data)]);
  return typeof result === 'string' ? JSON.parse(result) : result;
}
