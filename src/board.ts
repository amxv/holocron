#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { runBoardCli } from './board-main.ts';

const selectedDirectory = process.cwd();
// Anchor management and MCP to immutable installed code, never the invocation cwd.
// The original state-directory guard still rejects state under this code directory.
process.chdir(fileURLToPath(new URL('.', import.meta.url)));
const controller = new AbortController();
const stop = () => controller.abort();
process.once('SIGINT', stop); process.once('SIGTERM', stop);
try {
  process.exitCode = await runBoardCli(process.argv.slice(2), {
    stdin: process.stdin, out: (line) => console.log(line), error: (line) => console.error(line),
  }, undefined, { selectedDirectory, signal: controller.signal });
} finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
