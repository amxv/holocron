import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { readPrivateConfig } from './private-state.ts';

function urlMatches(value: string, predicate: (url: URL) => boolean): boolean {
  try { return predicate(new URL(value)); } catch { return false; }
}

const httpsUrl = z.string().max(2048).refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.search &&
      !/[\s"\\\u0000-\u001f\u007f]/.test(value);
  } catch { return false; }
}, 'An absolute HTTPS URL without credentials, query, or fragment is required');

export const configSchema = z.strictObject({
  issuer: httpsUrl,
  jwksUrl: httpsUrl,
  resource: httpsUrl.refine((value) => urlMatches(value, (url) => url.pathname === '/mcp' && url.href === value)),
  ownerSubject: z.string().min(1).max(256).regex(/^[^\s\u0000-\u001f\u007f]+$/),
  tokenType: z.enum(['at+jwt', 'JWT']),
  algorithm: z.enum(['RS256', 'ES256', 'EdDSA']),
  statusScope: z.string().min(1).max(128).regex(/^[A-Za-z0-9:._-]+$/),
  readScope: z.string().min(1).max(128).regex(/^[A-Za-z0-9:._-]+$/),
  writeScope: z.string().min(1).max(128).regex(/^[A-Za-z0-9:._-]+$/),
  stateDirectory: z.string().max(1024).refine((value) => isAbsolute(value) && resolve(value) === value).optional(),
  port: z.number().int().min(1024).max(65535).default(4317),
  allowedOrigins: z.array(httpsUrl.refine((value) => urlMatches(value, (url) => url.origin === value))).max(8).default([]),
}).refine((config) => new Set([config.statusScope, config.readScope, config.writeScope]).size === 3, 'All three scopes must differ');

export type ProbeConfig = z.infer<typeof configSchema>;

export async function loadConfig(path: string): Promise<ProbeConfig> {
  const bytes = await readPrivateConfig(path);
  if (bytes.byteLength > 16384) throw new Error('Configuration exceeds limit');
  return configSchema.parse(JSON.parse(bytes.toString('utf8')));
}

export function metadataUrl(config: ProbeConfig): string {
  return new URL('/.well-known/oauth-protected-resource/mcp', config.resource).href;
}

export function protectedResourceMetadata(config: ProbeConfig) {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: [config.statusScope, config.readScope, config.writeScope],
    bearer_methods_supported: ['header'],
    resource_name: 'Holocron explicit text bridge',
  };
}
