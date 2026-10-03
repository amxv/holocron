import { createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { ProbeConfig } from './config.ts';
import { metadataUrl } from './config.ts';

export class AuthFailure extends Error {
  readonly status: 401 | 403;
  readonly reason: 'invalid_token' | 'insufficient_scope';
  constructor(status: 401 | 403, reason: 'invalid_token' | 'insufficient_scope') {
    super('Authorization denied');
    this.status = status;
    this.reason = reason;
  }
}

export type AuthVerifier = (header: string | undefined) => Promise<AuthInfo>;

export function ownerId(config: ProbeConfig): string {
  return createHash('sha256').update(JSON.stringify([config.issuer, config.ownerSubject])).digest('hex');
}

export function makeVerifier(config: ProbeConfig, resolver?: JWTVerifyGetKey): AuthVerifier {
  const keys = resolver ?? createRemoteJWKSet(new URL(config.jwksUrl), {
    timeoutDuration: 3000, cooldownDuration: 30000, cacheMaxAge: 300000,
  });
  return async (header) => {
    if (!header || header.length > 6144 || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(header)) {
      throw new AuthFailure(401, 'invalid_token');
    }
    const token = header.slice(7);
    try {
      const { payload, protectedHeader } = await jwtVerify(token, keys, {
        issuer: config.issuer,
        audience: config.resource,
        algorithms: [config.algorithm],
        typ: config.tokenType,
        requiredClaims: ['iss', 'sub', 'aud', 'exp', 'iat', 'scope'],
        clockTolerance: 0,
      });
      const now = Math.floor(Date.now() / 1000);
      if (protectedHeader.jku || protectedHeader.jwk || protectedHeader.x5u || protectedHeader.x5c) {
        throw new AuthFailure(401, 'invalid_token');
      }
      const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      if (audience.length !== 1 || audience[0] !== config.resource ||
          (payload.resource !== undefined && payload.resource !== config.resource) ||
          !Number.isInteger(payload.exp) || !Number.isInteger(payload.iat) ||
          payload.iat! > now || payload.exp! <= payload.iat! || payload.exp! - payload.iat! > 3600 ||
          typeof payload.scope !== 'string' || payload.scope.length > 1024 ||
          !/^[A-Za-z0-9:._-]+(?: [A-Za-z0-9:._-]+)*$/.test(payload.scope)) {
        throw new AuthFailure(401, 'invalid_token');
      }
      if (payload.sub !== config.ownerSubject) throw new AuthFailure(403, 'insufficient_scope');
      const scopes = payload.scope.split(' ');
      if (!scopes.includes(config.statusScope)) throw new AuthFailure(403, 'insufficient_scope');
      // No names, emails, subject, issuer, or JWT are returned to the model.
      const principalId = ownerId(config);
      return {
        token, clientId: 'validated-owner', scopes, expiresAt: payload.exp!,
        resource: new URL(config.resource), extra: { principalId, ownerMatched: true },
      };
    } catch (error) {
      if (error instanceof AuthFailure) throw error;
      throw new AuthFailure(401, 'invalid_token');
    }
  };
}

export function hasPermission(auth: AuthInfo | undefined, config: ProbeConfig, scope: string): boolean {
  return auth?.extra?.ownerMatched === true && auth.extra.principalId === ownerId(config) &&
    auth.resource?.href === config.resource && auth.expiresAt !== undefined &&
    auth.expiresAt > Date.now() / 1000 && auth.scopes.includes(config.statusScope) && auth.scopes.includes(scope);
}

export function challenge(config: ProbeConfig, reason: 'invalid_token' | 'insufficient_scope', scopes: string[]): string {
  return `Bearer resource_metadata="${metadataUrl(config)}", scope="${scopes.join(' ')}", error="${reason}", error_description="Authorize the configured owner with the required bridge scopes"`;
}
