#!/usr/bin/env node
import { runCli } from './cli-main.ts';

process.exitCode = await runCli(process.argv.slice(2), {
  stdin: process.stdin, out: (line) => console.log(line), error: (line) => console.error(line),
});
