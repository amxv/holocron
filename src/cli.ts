#!/usr/bin/env node
import { loadConfig } from './config.ts';
import { makeVerifier } from './auth.ts';
import { createProbeHttp } from './http.ts';
import { VERSION } from './mcp.ts';
import { preparePlugin } from './plugin.ts';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('Usage: shared-clipboard-probe <start|check-config> --config <operator-owned JSON file>\n       shared-clipboard-probe prepare-plugin --connection-id <registered ID> --output <new directory>\nSynthetic probe only. See docs/phase1-setup.md for the unverified live gates.');
} else if (args.length === 1 && args[0] === '--version') {
  console.log(VERSION);
} else if (args.length === 5 && args[0] === 'prepare-plugin' && args[1] === '--connection-id' && args[3] === '--output') {
  try {
    await preparePlugin(args[2]!, args[4]!);
    console.log('Private plugin mapping prepared. Installation and actual Dots calls remain unverified.');
  } catch {
    console.error('Plugin preparation failed. Use a real registered ID and a new output directory.');
    process.exitCode = 1;
  }
} else if (args.length !== 3 || !['start', 'check-config'].includes(args[0]!) || args[1] !== '--config') {
  console.error('Invalid arguments. Use --help.');
  process.exitCode = 2;
} else {
  try {
    const config = await loadConfig(args[2]!);
    if (args[0] === 'check-config') {
      console.log('Configuration schema valid. Provider, OAuth, tunnel, Dots, and cloud clipboard remain unverified.');
    } else {
      const server = createProbeHttp(config, makeVerifier(config));
      server.on('error', () => { console.error('Probe listener failed.'); process.exitCode = 1; });
      server.listen(config.port, '127.0.0.1', () => console.log('Synthetic probe listening on IPv4 loopback. Live gates remain unverified.'));
      for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        process.once(signal, () => { server.close(); server.closeAllConnections(); });
      }
    }
  } catch {
    console.error('Invalid or unavailable operator configuration. See docs/phase1-setup.md.');
    process.exitCode = 1;
  }
}
