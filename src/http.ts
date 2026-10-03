import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types.js';
import { AuthFailure, challenge } from './auth.ts';
import type { AuthVerifier } from './auth.ts';
import { protectedResourceMetadata } from './config.ts';
import type { ProbeConfig } from './config.ts';
import { makeMcpServer } from './mcp.ts';

export const BODY_LIMIT = 16384;
export const REQUEST_DEADLINE_MS = 10000;
export const MAX_CONCURRENT = 16;
const METADATA_ROUTES = new Set(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']);

class HttpFailure extends Error {
  readonly status: number;
  constructor(status: number) { super('Request rejected'); this.status = status; }
}

function json(res: ServerResponse, status: number, data: unknown) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function reject(res: ServerResponse, status: number) {
  res.setHeader('Connection', 'close');
  json(res, status, { error: 'Request rejected' });
}

function duplicateSensitiveHeaders(req: IncomingMessage): boolean {
  const names = new Set<string>();
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    const name = req.rawHeaders[index]!.toLowerCase();
    if (!['host', 'authorization', 'origin', 'content-type', 'content-length', 'mcp-protocol-version'].includes(name)) continue;
    if (names.has(name)) return true;
    names.add(name);
  }
  return false;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const length = req.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > BODY_LIMIT)) throw new HttpFailure(413);
  return new Promise((resolve, rejectPromise) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > BODY_LIMIT) {
        req.pause();
        rejectPromise(new HttpFailure(413));
      } else chunks.push(chunk);
    });
    req.once('end', () => {
      try {
        const bytes = Buffer.concat(chunks);
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        const body: unknown = JSON.parse(text);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('One JSON-RPC message required');
        resolve(body);
      } catch { rejectPromise(new HttpFailure(400)); }
    });
    req.once('error', () => rejectPromise(new HttpFailure(400)));
    req.once('aborted', () => rejectPromise(new HttpFailure(400)));
  });
}

export function createProbeHttp(config: ProbeConfig, verify: AuthVerifier, options: { deadlineMs?: number } = {}) {
  let active = 0;
  const deadlineMs = options.deadlineMs ?? REQUEST_DEADLINE_MS;
  const server = createServer({ maxHeaderSize: 8192 }, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const deadline = setTimeout(() => {
      reject(res, 408);
      req.destroy();
    }, deadlineMs);
    let release = () => {};
    res.once('close', () => { clearTimeout(deadline); release(); });
    void (async () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : config.port;
      if (req.rawHeaders.length > 64) throw new HttpFailure(400);
      if (duplicateSensitiveHeaders(req) || req.headers.host !== `127.0.0.1:${port}`) throw new HttpFailure(403);
      const origin = req.headers.origin;
      if (origin !== undefined && !config.allowedOrigins.includes(origin)) throw new HttpFailure(403);
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate');
      }
      if (!req.url || (!METADATA_ROUTES.has(req.url) && req.url !== '/mcp')) throw new HttpFailure(404);
      if (METADATA_ROUTES.has(req.url)) {
        if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); throw new HttpFailure(405); }
        json(res, 200, protectedResourceMetadata(config));
        return;
      }
      if (req.method === 'OPTIONS') {
        if (!origin || req.headers['access-control-request-method'] !== 'POST') throw new HttpFailure(403);
        const requested = req.headers['access-control-request-headers'];
        if (typeof requested === 'string' && requested.split(',').some((name) =>
          !['authorization', 'accept', 'content-type', 'mcp-protocol-version'].includes(name.trim().toLowerCase()))) {
          throw new HttpFailure(403);
        }
        res.writeHead(204, {
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Authorization, Accept, Content-Type, MCP-Protocol-Version',
        }).end();
        return;
      }
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST, OPTIONS'); throw new HttpFailure(405); }
      if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '') ||
          req.headers['content-encoding'] !== undefined) throw new HttpFailure(415);
      if (req.headers['mcp-session-id'] !== undefined) throw new HttpFailure(400);
      const protocolVersion = req.headers['mcp-protocol-version'];
      if (protocolVersion !== undefined && (typeof protocolVersion !== 'string' || !SUPPORTED_PROTOCOL_VERSIONS.includes(protocolVersion))) {
        throw new HttpFailure(400);
      }
      if (active >= MAX_CONCURRENT) throw new HttpFailure(503);
      active += 1;
      let released = false;
      release = () => { if (!released) { active -= 1; released = true; } };
      // Authentication is repeated per HTTP message; no session can carry authority forward.
      const auth = await verify(req.headers.authorization);
      if (res.destroyed || res.writableEnded) return;
      const body = await readJson(req);
      if (res.destroyed || res.writableEnded) return;
      const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true, maxRequestBodySize: BODY_LIMIT });
      const mcp = makeMcpServer(config);
      res.once('close', () => { void mcp.close().catch(() => {}); });
      await mcp.connect(transport);
      const authenticatedRequest: IncomingMessage & { auth?: AuthInfo } = req;
      authenticatedRequest.auth = auth;
      await transport.handleRequest(authenticatedRequest, res, body);
    })().catch((error: unknown) => {
      if (res.headersSent || res.destroyed || res.writableEnded) return;
      if (error instanceof AuthFailure) {
        res.setHeader('WWW-Authenticate', challenge(config, error.reason, [config.statusScope]));
        reject(res, error.status);
      } else reject(res, error instanceof HttpFailure ? error.status : 500);
    });
  });
  server.headersTimeout = 5000;
  server.requestTimeout = deadlineMs;
  server.timeout = deadlineMs;
  server.keepAliveTimeout = 1000;
  server.maxHeadersCount = 32;
  server.maxConnections = 64;
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  server.on('checkContinue', (_req, res) => reject(res, 417));
  return server;
}
