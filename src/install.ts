import { installBundle } from './installation.ts';

try {
  const args = process.argv.slice(2);
  if (args.length !== 6) throw new Error('Invalid installer invocation');
  const [prefix, bin, node, bundle, version, digest] = args as [string, string, string, string, string, string];
  const result = await installBundle({ prefix, bin, node, bundle, version, digest });
  console.log(`Holocron ${result.version} ${result.unchanged ? 'already installed' : 'installed'}.`);
  console.log(`Run "${bin}/holocron" --help. Add "${bin}" to PATH if needed.`);
  console.log('Run holocron setup for the Mac, or holocron setup receiver --code CODE for a receiver.');
  console.log('Setup saves references; holocron start runs the Mac services.');
} catch (error) {
  console.error(`Holocron install failed: ${error instanceof Error ? error.message : 'inspect the dedicated prefix and retry'}`);
  process.exitCode = 1;
}
