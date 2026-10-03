import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { ownerId } from '../src/auth.ts';
import { ShareStore } from '../src/store.ts';
import { ClipboardBridge } from '../src/bridge.ts';
import type { ClipboardAdapter } from '../src/clipboard.ts';
import { config } from './fixtures.ts';

export const literal = '\ufeffUnicode 雪 🚀 café\n"quotes" \'single\' `backticks` $(touch SHOULD_NEVER_EXIST) $HOME\nsecond line\n';
export async function temporary(t: TestContext) {
  const directory = await mkdtemp(join(await realpath('/tmp'), 'sc-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

export function memoryClipboard(): ClipboardAdapter & { value: Buffer; reads: number; writes: number } {
  return { availability: 'test-adapter', value: Buffer.from(literal), reads: 0, writes: 0,
    async read(signal) { if (signal.aborted) throw new Error('aborted'); this.reads++; return Buffer.from(this.value); },
    async write(bytes, signal) { if (signal.aborted) throw new Error('aborted'); this.writes++; this.value = Buffer.from(bytes); },
  };
}

export async function bridgeFixture(t: TestContext, options: { now?: () => number; aggregateLimit?: number } = {}) {
  const directory = await temporary(t);
  const store = await ShareStore.open(directory, ownerId(config), options);
  t.after(() => store.close());
  const adapter = memoryClipboard();
  const bridge = new ClipboardBridge(store, adapter, options.now);
  t.after(() => bridge.stop());
  return { directory, store, adapter, bridge };
}
