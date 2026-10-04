import { basename, dirname, join } from 'node:path';
import { VERSION } from './version.ts';

// Only helpers under the saved setup home with our exact generated names are
// automatically refreshed. Explicit external helpers stay operator-controlled.
export function ownedPromptVersion(home: string, prompt: string): string | undefined {
  const directory = dirname(prompt);
  if (basename(prompt) !== 'holocron-secrets-ui' || dirname(directory) !== home) return undefined;
  const name = basename(directory);
  if (name === 'native-prompt-v3') return 'legacy';
  return /^native-prompt-(\d+\.\d+\.\d+)-[a-f0-9-]{36}$/.exec(name)?.[1];
}

export function promptNeedsRefresh(home: string, prompt: string): boolean {
  const version = ownedPromptVersion(home, prompt);
  return version !== undefined && version !== VERSION;
}

export const promptBuildDirectory = (home: string, id: string) => join(home, `native-prompt-${VERSION}-${id}`);
