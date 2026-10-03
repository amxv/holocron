import { createHash } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { challenge, hasPermission } from './auth.ts';
import type { ProbeConfig } from './config.ts';

export const PROBE_ID = 'phase1-marker';
export const PROBE_TEXT = 'Shared Clipboard Phase 1: synthetic data only.\n';
export const PROBE_DIGEST = createHash('sha256').update(PROBE_TEXT).digest('hex');
export const VERSION = '0.1.0';

const statusOutput = z.strictObject({
  mode: z.literal('synthetic-probe'),
  localTransport: z.literal('available'),
  tunnel: z.literal('unverified'),
  dot: z.literal('unverified'),
  cloudClipboard: z.literal('unverified'),
  capabilities: z.tuple([z.literal('synthetic-status'), z.literal('synthetic-read')]),
  authorization: z.strictObject({ ownerMatched: z.literal(true), principalId: z.string().regex(/^[a-f0-9]{64}$/) }),
});
const readOutput = z.strictObject({
  id: z.literal(PROBE_ID), text: z.literal(PROBE_TEXT),
  sha256: z.literal(PROBE_DIGEST), byteCount: z.literal(Buffer.byteLength(PROBE_TEXT)),
});

function denied(config: ProbeConfig, scope: string): CallToolResult {
  return {
    isError: true, content: [{ type: 'text', text: 'Authorization required for this synthetic probe.' }],
    _meta: { 'mcp/www_authenticate': [challenge(config, 'insufficient_scope', [config.statusScope, scope])] },
  };
}

function result(data: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
}

export function makeMcpServer(config: ProbeConfig): McpServer {
  const server = new McpServer({ name: 'shared-clipboard-dots-probe', version: VERSION }, {
    instructions: 'Synthetic Phase 1 compatibility probe only. No files, credentials, clipboard operations, shell, or URL fetch. Call get_bridge_status to prove authenticated owner access; read_synthetic_probe reads only phase1-marker. Local availability does not prove tunnel, dot, or cloud clipboard compatibility.',
  });
  const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true };
  const statusInput = z.strictObject({});
  const readInput = z.strictObject({ id: z.literal(PROBE_ID) });
  const schemes = (scope: string) => [{ type: 'oauth2' as const, scopes: [...new Set([config.statusScope, scope])] }];
  const definitions = [
    { name: 'get_bridge_status', title: 'Check synthetic bridge probe',
      description: 'Verify authenticated owner access and local synthetic probe availability. Does not assert tunnel, dot, or cloud clipboard capability.',
      inputSchema: z.toJSONSchema(statusInput, { target: 'draft-7' }), outputSchema: z.toJSONSchema(statusOutput, { target: 'draft-7' }),
      securitySchemes: schemes(config.statusScope), annotations,
      _meta: { securitySchemes: schemes(config.statusScope) } },
    { name: 'read_synthetic_probe', title: 'Read fixed synthetic marker',
      description: 'Read the fixed harmless phase1-marker with its SHA-256 digest. No paths, personal data, clipboard data, or arbitrary identifiers are accepted.',
      inputSchema: z.toJSONSchema(readInput, { target: 'draft-7' }), outputSchema: z.toJSONSchema(readOutput, { target: 'draft-7' }),
      securitySchemes: schemes(config.readScope), annotations,
      _meta: { securitySchemes: schemes(config.readScope) } },
  ];
  server.registerTool('get_bridge_status', {
    title: definitions[0]!.title, description: definitions[0]!.description,
    inputSchema: statusInput, outputSchema: statusOutput, annotations, _meta: definitions[0]!._meta,
  }, async (_args, extra) => {
    if (!hasPermission(extra.authInfo, config, config.statusScope)) return denied(config, config.statusScope);
    return result({
      mode: 'synthetic-probe', localTransport: 'available', tunnel: 'unverified', dot: 'unverified',
      cloudClipboard: 'unverified', capabilities: ['synthetic-status', 'synthetic-read'],
      authorization: { ownerMatched: true, principalId: extra.authInfo!.extra!.principalId },
    });
  });
  server.registerTool('read_synthetic_probe', {
    title: definitions[1]!.title, description: definitions[1]!.description,
    inputSchema: readInput, outputSchema: readOutput, annotations, _meta: definitions[1]!._meta,
  }, async (_args, extra) => {
    if (!hasPermission(extra.authInfo, config, config.readScope)) return denied(config, config.readScope);
    return result({ id: PROBE_ID, text: PROBE_TEXT, sha256: PROBE_DIGEST, byteCount: Buffer.byteLength(PROBE_TEXT) });
  });
  // SDK 1.32's registerTool config has no top-level securitySchemes field.
  // Publish OpenAI's required top-level metadata and its compatibility mirror explicitly.
  server.server.setRequestHandler(ListToolsRequestSchema, async (_request, extra) => {
    if (!hasPermission(extra.authInfo as AuthInfo | undefined, config, config.statusScope)) {
      throw new Error('Authorization denied');
    }
    return { tools: definitions };
  });
  return server;
}
