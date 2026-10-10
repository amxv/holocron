import { createHash, timingSafeEqual } from 'node:crypto';
import { object, parseChannel, parseEnvelope, parseSecretRequest, SecretFailure, SECRET_WIRE_LIMIT, idPattern } from './secret-shapes.ts';
import { codeRelay } from './pairing-code-relay.ts';
import { PAIRED_TEXT_TTL_MS } from './paired-text-wire.ts';

export interface SecretRedis { eval(script: string, keys: string[], args: unknown[]): Promise<unknown> }
// All state transitions, authorization, quotas, consumption and replay tombstones are atomic.
// The store receives public request metadata and NaCl ciphertext, never secret plaintext.
export const secretRelayScript = `
local action = ARGV[1]
local now = tonumber(ARGV[2])
local token = ARGV[3]
local data = cjson.decode(ARGV[4])
if action == 'provision' then
  if redis.call('SET', KEYS[1], ARGV[4], 'PX', data.expiresAt-now, 'NX') then return '{"ok":true}' end
  return '{"error":"pairing_exists"}'
end
local raw = redis.call('GET', KEYS[1])
if not raw then return '{"error":"unauthorized"}' end
local channel = cjson.decode(raw)
if channel.expiresAt <= now then return '{"error":"unauthorized"}' end
local mac = token == channel.macTokenHash
local receiver = token == channel.receiverTokenHash
if not mac and not receiver then return '{"error":"unauthorized"}' end
local count = redis.call('INCR', KEYS[4])
if count == 1 then redis.call('PEXPIRE', KEYS[4], 60000) end
if count > 240 then return '{"error":"rate_limited"}' end
if action == 'revoke' then
  if not mac then return '{"error":"unauthorized"}' end
  redis.call('DEL', KEYS[1], KEYS[2], KEYS[1]..':inbox:mac', KEYS[1]..':inbox:receiver')
  return '{"ok":true}'
end
-- The same token hashes authorize an independent E2E ciphertext inbox.
-- The relay never receives a snippet label or plaintext and cannot choose the sender.
if string.sub(action,1,5)=='text-' then
  local destination = mac and 'receiver' or 'mac'
  if action ~= 'text-send' then destination = mac and 'mac' or 'receiver' end
  local inbox = KEYS[1]..':inbox:'..destination
  redis.call('ZREMRANGEBYSCORE', inbox, '-inf', now)
  if action == 'text-list' then
    local ids=redis.call('ZREVRANGE',inbox,0,99)
    local items={}
    for _,id in ipairs(ids) do
      local raw=redis.call('GET',KEYS[1]..':message:'..destination..':'..id)
      if raw then
        local item=cjson.decode(raw)
        table.insert(items,{id=id,sentAt=item.sentAt,expiresAt=item.expiresAt})
      end
    end
    if #items==0 then return '{"items":[]}' end
    return cjson.encode({items=items})
  end
  local itemKey=KEYS[1]..':message:'..destination..':'..data.id
  if action == 'text-send' then
    if data.expiresAt>channel.expiresAt or data.expiresAt<=now or data.expiresAt>now+86400000 then return '{"error":"message_expired"}' end
    if redis.call('ZCARD',inbox)>=100 then return '{"error":"inbox_full"}' end
    local replay=KEYS[1]..':message-replay:'..data.id
    if redis.call('EXISTS',replay)==1 then return '{"error":"message_replayed"}' end
    local ttl=data.expiresAt-now
    redis.call('SET',replay,'1','PX',ttl)
    redis.call('SET',itemKey,cjson.encode({id=data.id,sentAt=now,expiresAt=data.expiresAt,envelope=data.envelope}),'PX',ttl)
    redis.call('ZADD',inbox,data.expiresAt,data.id)
    redis.call('PEXPIRE',inbox,86400000)
    return cjson.encode({ok=true,id=data.id,sentAt=now,expiresAt=data.expiresAt})
  end
  if action == 'text-read' then
    local raw=redis.call('GET',itemKey)
    if not raw then return '{"error":"message_unavailable"}' end
    if cjson.decode(raw).expiresAt<=now then
      redis.call('DEL',itemKey)
      redis.call('ZREM',inbox,data.id)
      return '{"error":"message_unavailable"}'
    end
    return raw
  end
  if action == 'text-delete' then
    if redis.call('DEL',itemKey)==0 then return '{"error":"message_unavailable"}' end
    redis.call('ZREM',inbox,data.id)
    return '{"deleted":true}'
  end
  return '{"error":"invalid_arguments"}'
end
local current = redis.call('GET', KEYS[2])
local state = nil
if current then state = cjson.decode(current) end
if action == 'create' then
  if not receiver then return '{"error":"unauthorized"}' end
  if data.expiresAt > channel.expiresAt or data.expiresAt <= now then return '{"error":"request_expired"}' end
  if redis.call('EXISTS', KEYS[3]) == 1 then return '{"error":"request_replayed"}' end
  if state and (state.state == 'pending' or state.state == 'claimed' or state.state == 'delivered') then return '{"error":"request_busy"}' end
  local quota = tonumber(redis.call('GET', KEYS[5]) or '0')
  if quota >= 10 then return '{"error":"request_rate_limited"}' end
  redis.call('INCR', KEYS[5]); if quota == 0 then redis.call('PEXPIRE', KEYS[5], 3600000) end
  redis.call('SET', KEYS[3], '1', 'PX', data.expiresAt-now)
  redis.call('SET', KEYS[2], cjson.encode({state='pending',request=data}), 'PX', data.expiresAt-now)
  return '{"ok":true}'
end
if action == 'claim' then
  if not mac then return '{"error":"unauthorized"}' end
  if not state or state.state ~= 'pending' or state.request.expiresAt <= now then return '{"request":null}' end
  state.state = 'claimed'; redis.call('SET', KEYS[2], cjson.encode(state), 'KEEPTTL')
  return cjson.encode({request=state.request})
end
if not state or state.request.id ~= data.id or state.request.expiresAt <= now then return '{"error":"request_unavailable"}' end
if action == 'cancel' then
  if state.state == 'consumed' then return '{"error":"request_unavailable"}' end
  state.state='cancelled'; state.envelope=nil
  redis.call('SET', KEYS[2], cjson.encode(state), 'KEEPTTL'); return '{"ok":true}'
end
if action == 'status' then return cjson.encode({state=state.state}) end
if action == 'deliver' then
  if not mac then return '{"error":"unauthorized"}' end
  if state.state ~= 'claimed' then return '{"error":"request_unavailable"}' end
  state.state='delivered'; state.envelope=data.envelope
  redis.call('SET', KEYS[2], cjson.encode(state), 'KEEPTTL'); return '{"ok":true}'
end
if action == 'receive' then
  if not receiver then return '{"error":"unauthorized"}' end
  if state.state ~= 'delivered' then return cjson.encode({state=state.state}) end
  local envelope=state.envelope; state.state='consumed'; state.envelope=nil
  redis.call('SET', KEYS[2], cjson.encode(state), 'KEEPTTL')
  return cjson.encode({state='delivered',envelope=envelope})
end
return '{"error":"invalid_arguments"}'
`;

const digest = (value: string) => createHash('sha256').update(value).digest();
const safeEqual = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

export function secretRelay(redis: SecretRedis, adminToken: string, now = Date.now) {
  return async (request: Request): Promise<Response> => {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    const reply = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers });
    try {
      const url = new URL(request.url);
      if (request.method !== 'POST' || url.search || request.headers.has('origin') ||
          request.headers.get('content-type') !== 'application/json') return reply(400, { error: 'invalid_request' });
      const authorization = request.headers.get('authorization');
      if (!authorization || !/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization)) return reply(401, { error: 'unauthorized' });
      const token = authorization.slice(7);
      if (Number(request.headers.get('content-length') ?? 0) > SECRET_WIRE_LIMIT) return reply(413, { error: 'request_too_large' });
      const reader = request.body?.getReader();
      if (!reader) return reply(400, { error: 'invalid_request' });
      const inputDeadline = AbortSignal.any([request.signal, AbortSignal.timeout(5000)]);
      const stopRead = () => { void reader.cancel().catch(() => {}); };
      inputDeadline.addEventListener('abort', stopRead, { once: true });
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (inputDeadline.aborted) throw new SecretFailure('request_timed_out');
          if (next.done) break;
          size += next.value.length;
          if (size > SECRET_WIRE_LIMIT) { await reader.cancel(); return reply(413, { error: 'request_too_large' }); }
          chunks.push(next.value);
        }
      } finally { inputDeadline.removeEventListener('abort', stopRead); reader.releaseLock(); }
      const body = object(JSON.parse(Buffer.concat(chunks).toString('utf8')), ['action', 'channel', 'data']);
      if (typeof body.action === 'string' && body.action.startsWith('code-')) {
        const result = await codeRelay(redis, adminToken, body.action, body.channel, body.data, token, now());
        return reply(result.error === 'unauthorized' ? 401 : result.error === 'rate_limited' ? 429 : result.error ? 409 : 200, result);
      }
      if (typeof body.channel !== 'string' || !idPattern.test(body.channel) || typeof body.action !== 'string') throw new SecretFailure('invalid_arguments');
      const clock = now(); const action = body.action; let data: unknown; let requestId = 'none';
      if (action === 'provision') {
        if (!/^[A-Za-z0-9_-]{43}$/.test(adminToken) || !safeEqual(token, adminToken)) return reply(401, { error: 'unauthorized' });
        data = parseChannel(body.data, clock);
        if ((data as { channel: string }).channel !== body.channel) throw new SecretFailure('invalid_pairing');
      } else if (action === 'create') {
        data = parseSecretRequest(body.data, clock);
        if ((data as { channel: string }).channel !== body.channel) throw new SecretFailure('invalid_arguments');
        requestId = (data as { id: string }).id;
      } else if (action === 'text-send') {
        const d = object(body.data, ['id', 'expiresAt', 'envelope']);
        if (typeof d.id !== 'string' || !idPattern.test(d.id) || !Number.isSafeInteger(d.expiresAt) ||
            Number(d.expiresAt) <= clock || Number(d.expiresAt) > clock + PAIRED_TEXT_TTL_MS) throw new SecretFailure('invalid_arguments');
        data = { id: d.id, expiresAt: d.expiresAt, envelope: parseEnvelope(d.envelope) };
        requestId = d.id;
      } else if (action === 'text-read' || action === 'text-delete') {
        const d = object(body.data, ['id']);
        if (typeof d.id !== 'string' || !idPattern.test(d.id)) throw new SecretFailure('invalid_arguments');
        data = { id: d.id }; requestId = d.id;
      } else if (action === 'text-list') {
        object(body.data, []); data = {};
      } else if (['cancel', 'status', 'deliver', 'receive'].includes(action)) {
        const d = object(body.data, action === 'deliver' ? ['id', 'envelope'] : ['id']);
        if (typeof d.id !== 'string' || !idPattern.test(d.id)) throw new SecretFailure('invalid_arguments');
        data = { id: d.id, ...(action === 'deliver' ? { envelope: parseEnvelope(d.envelope) } : {}) };
      } else if (action === 'claim' || action === 'revoke') {
        object(body.data, []); data = {};
      } else throw new SecretFailure('invalid_arguments');
      const prefix = `board-secret-v1:${body.channel}`;
      const output = await redis.eval(secretRelayScript, [prefix, `${prefix}:current`, `${prefix}:replay:${requestId}`,
        `${prefix}:rate`, `${prefix}:quota`], [action, clock, digest(token).toString('hex'), JSON.stringify(data)]);
      const parsed = typeof output === 'string' ? JSON.parse(output) : output;
      const error = (parsed as { error?: string })?.error;
      return reply(error === 'unauthorized' ? 401 : error?.includes('rate_limited') ? 429 : error ? 409 : 200, parsed);
    } catch (error) {
      return reply(error instanceof SecretFailure ? 400 : 503, { error: error instanceof SecretFailure ? error.code : 'relay_unavailable' });
    }
  };
}
