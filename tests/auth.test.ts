import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPair, SignJWT } from 'jose';
import { AuthFailure, makeVerifier, hasPermission, challenge } from '../src/auth.ts';
import { configSchema, protectedResourceMetadata, metadataUrl } from '../src/config.ts';
import { config, keyPair, localKeys, token } from './fixtures.ts';

const verify = makeVerifier(config, localKeys);
test('signed owner token is resource-bound with distinct probe scopes', async () => {
  const auth = await verify(`Bearer ${await token()}`);
  assert.equal(auth.extra?.ownerMatched, true);
  assert.match(String(auth.extra?.principalId), /^[a-f0-9]{64}$/);
  assert.equal(hasPermission(auth, config, config.readScope), true);
  assert.equal(hasPermission(undefined, config, config.readScope), false);
  assert.equal(hasPermission({ ...auth, expiresAt: 0 }, config, config.readScope), false);
  assert.equal(hasPermission({ ...auth, resource: new URL('https://different.invalid/mcp') }, config, config.readScope), false);
  assert.equal(hasPermission({ ...auth, extra: { ownerMatched: false } }, config, config.readScope), false);
  assert.equal(hasPermission({ ...auth, extra: { ownerMatched: true, principalId: 'a'.repeat(64) } }, config, config.readScope), false);
});

const now = Math.floor(Date.now() / 1000);
const invalidClaims = [
  ['issuer', { iss: 'https://other-issuer.invalid' }],
  ['owner', { sub: 'another-owner' }],
  ['missing owner', { sub: undefined }],
  ['audience', { aud: 'https://other-resource.invalid/mcp' }],
  ['multiple audiences', { aud: [config.resource, 'https://other-resource.invalid/mcp'] }],
  ['resource', { resource: 'https://other-resource.invalid/mcp' }],
  ['expired', { iat: now - 10, exp: now - 1 }],
  ['missing expiry', { exp: undefined }],
  ['missing issued-at', { iat: undefined }],
  ['future issued-at', { iat: now + 60 }],
  ['future not-before', { nbf: now + 60 }],
  ['expiry before issued-at', { iat: now, exp: now - 1 }],
  ['overlong lifetime', { exp: now + 3601 }],
  ['fractional expiry', { exp: now + 0.5 }],
  ['missing scopes', { scope: undefined }],
  ['array scopes', { scope: ['probe:status'] }],
  ['invalid scopes', { scope: 'probe:status\nprobe:read' }],
  ['double-space scopes', { scope: 'probe:status  probe:read' }],
  ['no status scope', { scope: 'probe:read' }],
] as const;
for (const [name, claims] of invalidClaims) {
  test(`reject ${name}`, async () => {
    await assert.rejects(verify(`Bearer ${await token(claims)}`), AuthFailure);
  });
}
test('reject signature, key, algorithm, token type, embedded keys and token-directed URLs', async () => {
  const wrongKey = await generateKeyPair('ES256');
  const jwt = await new SignJWT({ iss: config.issuer }).setProtectedHeader({ alg: 'ES256', kid: 'synthetic-key', typ: 'at+jwt' }).sign(wrongKey.privateKey);
  await assert.rejects(verify(`Bearer ${jwt}`), AuthFailure);
  for (const header of [
    { alg: 'ES256', typ: 'id+jwt' }, { alg: 'ES256', kid: 'unknown' },
    { alg: 'ES256', jku: 'https://attacker.invalid/jwks' },
    { alg: 'ES256', x5u: 'https://attacker.invalid/key' },
    { alg: 'ES256', x5c: ['untrusted-certificate'] },
    { alg: 'ES256', jwk: { kty: 'EC' } },
  ]) await assert.rejects(verify(`Bearer ${await token({}, header)}`), AuthFailure);
  const hmac = await new SignJWT({}).setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' }).sign(new Uint8Array(32));
  await assert.rejects(verify(`Bearer ${hmac}`), AuthFailure);
  const wrongAlgorithm = makeVerifier({ ...config, algorithm: 'RS256' }, localKeys);
  await assert.rejects(wrongAlgorithm(`Bearer ${await token()}`), AuthFailure);
  assert.ok(keyPair.publicKey);
});
test('reject malformed, oversized, missing and query-style credentials without echo', async () => {
  for (const header of [undefined, '', 'Basic secret-sentinel', 'Bearer a.b.', 'Bearer a.b.c', 'Bearer '+ 'a'.repeat(6145), 'Bearer secret-sentinel\n']) {
    await assert.rejects(verify(header), (error: unknown) => error instanceof AuthFailure && !error.message.includes('secret-sentinel'));
  }
});
test('status permission does not authorize synthetic reads', async () => {
  const auth = await verify(`Bearer ${await token({ scope: config.statusScope })}`);
  assert.equal(hasPermission(auth, config, config.statusScope), true);
  assert.equal(hasPermission(auth, config, config.readScope), false);
});
test('provider input is constrained, metadata advertises resource and actual scopes only', () => {
  assert.deepEqual(protectedResourceMetadata(config), {
    resource: config.resource, authorization_servers: [config.issuer],
    scopes_supported: [config.statusScope, config.readScope, config.writeScope], bearer_methods_supported: ['header'],
    resource_name: 'Holocron explicit text bridge',
  });
  assert.equal(metadataUrl(config), 'https://synthetic-resource.invalid/.well-known/oauth-protected-resource/mcp');
  assert.ok(challenge(config, 'invalid_token', [config.statusScope]).includes(`resource_metadata="${metadataUrl(config)}"`));
  for (const patch of [
    { issuer: 'http://issuer.invalid' }, { jwksUrl: 'file:///private/key' },
    { resource: 'https://resource.invalid/not-mcp' }, { resource: 'https://resource.invalid/mcp?token=secret' },
    { issuer: 'https://username:password@issuer.invalid' }, { jwksUrl: 'https://issuer.invalid/jwks#fragment' },
    { statusScope: 'probe:status"' }, { readScope: config.statusScope }, { writeScope: config.readScope }, { ownerSubject: '' },
    { tokenType: 'none' }, { algorithm: 'HS256' }, { allowedOrigins: ['*'] },
    { allowedOrigins: ['https://client.invalid/path'] }, { clientSecret: 'secret-sentinel' },
  ]) assert.equal(configSchema.safeParse({ ...config, ...patch }).success, false);
});
