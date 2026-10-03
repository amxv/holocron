import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function preparePlugin(connectionId: string, output: string): Promise<void> {
  if (!/^plugin_asdk_app_[A-Za-z0-9]+$/.test(connectionId) || connectionId.length > 128) {
    throw new Error('A real registered connection ID is required');
  }
  const manifest = await readFile(new URL('../plugins/shared-clipboard/plugin.json', import.meta.url));
  // Create a new owner-only directory. Never mutate an existing plugin or marketplace.
  await mkdir(output, { mode: 0o700 });
  await writeFile(join(output, 'plugin.json'), manifest, { mode: 0o600, flag: 'wx' });
  await writeFile(join(output, '.app.json'), JSON.stringify({ apps: { 'shared-clipboard-probe': { id: connectionId } } }, null, 2) + '\n', {
    mode: 0o600, flag: 'wx',
  });
}
