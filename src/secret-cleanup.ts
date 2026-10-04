import { setTimeout as delay } from 'node:timers/promises';
import { SECRET_FILE_MS } from './secret-shapes.ts';
import { removeSecretFiles, validateSecretFiles } from './secret-files.ts';

try {
  const [directory, rawExpiry, ...extra] = process.argv.slice(2); const expiry = Number(rawExpiry);
  if (!directory || extra.length || !Number.isSafeInteger(expiry) || expiry > Date.now() + SECRET_FILE_MS + 1000) throw new Error('invalid_cleanup');
  await validateSecretFiles(directory, expiry);
  process.send?.({ ready: true });
  await delay(Math.max(0, expiry - Date.now()));
  await removeSecretFiles(directory, expiry);
} catch { process.exitCode = 1; }
