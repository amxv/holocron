#!/usr/bin/env node
import { runCloudCli } from './cloud-cli-main.ts';

const controller = new AbortController();
const cancel = () => controller.abort();
process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
try {
  process.exitCode = await runCloudCli(process.argv.slice(2), {
    stdin: process.stdin, out: (line) => console.log(line), error: (line) => console.error(line),
  }, undefined, controller.signal);
} finally {
  process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
  process.stdin.destroy();
}
