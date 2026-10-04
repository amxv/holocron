import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { currentUid, readPrivateConfig } from './private-state.ts';

// Local execution supplies authority, never client-controlled MCP metadata.
// A separate config shape cannot switch the OAuth HTTP listener to no-auth.
export const localConfigSchema = z.strictObject({
  transport: z.literal('stdio'),
  stateDirectory: z.string().min(1).max(1024).refine((value) => isAbsolute(value) && resolve(value) === value),
});
export type LocalConfig = z.infer<typeof localConfigSchema>;

export function localOwnerId(): string {
  // Stable persisted owner namespace: renaming it would orphan shares and retry receipts.
  return createHash('sha256').update(JSON.stringify(['shared-clipboard-local-stdio-v1', currentUid()])).digest('hex');
}

export async function loadLocalConfig(path: string): Promise<LocalConfig> {
  return localConfigSchema.parse(JSON.parse((await readPrivateConfig(path)).toString('utf8')));
}
