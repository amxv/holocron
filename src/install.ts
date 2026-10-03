import { installBundle } from './installation.ts';

try {
  const args = process.argv.slice(2);
  if (args.length !== 6) throw new Error('Invalid installer invocation');
  const [prefix, bin, node, bundle, version, digest] = args as [string, string, string, string, string, string];
  const result = await installBundle({ prefix, bin, node, bundle, version, digest });
  console.log(`Board ${result.version} ${result.unchanged ? 'already installed' : 'installed'}.`);
  console.log(`Run "${bin}/board" --help. Add "${bin}" to PATH if needed.`);
  console.log('For an existing setup, explicitly run board link --local-config /absolute/private/local.json.');
  console.log('For a new setup, run board init, then configure your private tunnel. Nothing was started.');
} catch (error) {
  console.error(`Board install failed: ${error instanceof Error ? error.message : 'inspect the dedicated prefix and retry'}`);
  process.exitCode = 1;
}
