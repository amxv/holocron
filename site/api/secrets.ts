import { Redis } from '@upstash/redis';
import { secretRelay } from '../../src/secret-relay.ts';

// Dedicated API; static documentation, clipboard MCP and existing tunnel remain independent.
export default {
  async fetch(request: Request): Promise<Response> {
    try {
      if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN ||
          !/^[A-Za-z0-9_-]{43}$/.test(process.env.HOLOCRON_SECRETS_ADMIN_TOKEN ?? '')) throw new Error('relay_not_configured');
      const redis = Redis.fromEnv({ retry: false, enableTelemetry: false, latencyLogging: false,
        enableAutoPipelining: false, automaticDeserialization: false, signal: () => AbortSignal.timeout(5000) });
      const handler = secretRelay(redis, process.env.HOLOCRON_SECRETS_ADMIN_TOKEN ?? '');
      return await handler(request);
    } catch {
      // Never log headers, credentials, payloads or exception diagnostics.
      return new Response('{"error":"relay_unavailable"}', { status: 503,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }
  },
};
