import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import type { JWTHeaderParameters } from 'jose';
import { configSchema } from '../src/config.ts';

export const config = configSchema.parse({
  issuer: 'https://synthetic-issuer.invalid', jwksUrl: 'https://synthetic-issuer.invalid/jwks',
  resource: 'https://synthetic-resource.invalid/mcp', ownerSubject: 'synthetic-owner',
  tokenType: 'at+jwt', algorithm: 'ES256', statusScope: 'probe:status', readScope: 'probe:read', writeScope: 'clipboard:write',
  allowedOrigins: ['https://synthetic-client.invalid'],
});
export const keyPair = await generateKeyPair('ES256');
const publicJwk = { ...await exportJWK(keyPair.publicKey), kid: 'synthetic-key', alg: 'ES256' };
export const localKeys = createLocalJWKSet({ keys: [publicJwk] });

export async function token(overrides: Record<string, unknown> = {}, header: JWTHeaderParameters = { alg: 'ES256' }) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: config.issuer, sub: config.ownerSubject, aud: config.resource,
    iat: now, exp: now + 300, scope: 'probe:status probe:read', ...overrides,
  }).setProtectedHeader({ typ: 'at+jwt', kid: 'synthetic-key', ...header }).sign(keyPair.privateKey);
}
