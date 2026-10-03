import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { challenge, hasPermission } from './auth.ts';
import type { ProbeConfig } from './config.ts';
import { localOwnerId } from './local-config.ts';

type Scheme = { type: 'oauth2'; scopes: string[] } | { type: 'noauth' };
export interface McpPolicy {
  local: boolean;
  statusScope: string; readScope: string; writeScope: string;
  allowed(auth: AuthInfo | undefined, scope: string): boolean;
  principal(auth: AuthInfo | undefined): unknown;
  schemes(scope: string): Scheme[];
  denied(scope: string): CallToolResult;
}

export function oauthPolicy(config: ProbeConfig): McpPolicy {
  return { ...config, local: false,
    allowed: (auth, scope) => hasPermission(auth, config, scope),
    principal: (auth) => auth!.extra!.principalId,
    schemes: (scope) => [{ type: 'oauth2', scopes: [...new Set([config.statusScope, scope])] }],
    denied: (scope) => ({ isError: true, content: [{ type: 'text', text: 'Authorization required for this bridge operation.' }],
      _meta: { 'mcp/www_authenticate': [challenge(config, 'insufficient_scope', [config.statusScope, scope])] } }),
  };
}

export function localPolicy(owner: string, signal: AbortSignal): McpPolicy {
  if (owner !== localOwnerId()) throw new Error('Local owner mismatch');
  return { local: true, statusScope: 'status', readScope: 'read', writeScope: 'write',
    allowed: () => !signal.aborted,
    principal: () => owner,
    schemes: () => [{ type: 'noauth' }],
    denied: () => ({ isError: true, content: [{ type: 'text', text: 'bridge_unavailable' }] }),
  };
}
