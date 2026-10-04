import { rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

// Prevent renamed modules from surviving in a production package as stale output.
await rm('dist', { recursive: true, force: true });
execFileSync('tsc', ['-p', 'tsconfig.build.json'], { stdio: 'inherit' });
