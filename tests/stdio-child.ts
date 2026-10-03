// Test subprocess only. The distributed CLI has no clipboard command override.
import { appendFile } from 'node:fs/promises';
import { runCli } from '../src/cli-main.ts';
import { ClipboardFailure } from '../src/clipboard.ts';
import type { ClipboardAdapter } from '../src/clipboard.ts';

const events = process.env.BOARD_TEST_EVENTS!;
const mode = process.env.BOARD_TEST_MODE ?? 'success';
const log = (data: unknown) => appendFile(events, JSON.stringify(data) + '\n', { mode: 0o600 });
const adapter: ClipboardAdapter = {
  availability: mode === 'unavailable' ? 'unavailable' : 'test-adapter',
  async read() { throw new Error('No implicit capture permitted'); },
  async write(bytes, signal) {
    await log({ phase: 'dispatch', bytes: Buffer.from(bytes).toString('base64') });
    if (mode === 'failure') throw new ClipboardFailure(false);
    if (mode === 'slow' || mode === 'blocked') {
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new ClipboardFailure(true)); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, mode === 'slow' ? 300 : 10000);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
    }
    await log({ phase: 'completed' });
  },
};
process.exitCode = await runCli(process.argv.slice(2), {
  stdin: process.stdin, out: (line) => console.log(line), error: (line) => console.error(line),
}, adapter);
