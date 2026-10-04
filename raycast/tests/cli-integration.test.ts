import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { shareClipboard, shareFile } from "../src/lib/holocron";

const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
test("Raycast contract runs the monorepo production CLI against isolated config/state and literal selected files", async (t) => {
  const root = await mkdtemp(join(await realpath("/tmp"), "holocron-raycast-integration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "home");
  await mkdir(home, { mode: 0o700 });
  const state = join(root, "state");
  const config = join(root, "local.json");
  await writeFile(config, JSON.stringify({ transport: "stdio", stateDirectory: state }), { mode: 0o600 });
  const entry = resolve("../dist/holocron.js");
  const executable = join(root, "holocron with spaces;$(literal)");
  await writeFile(executable, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(entry)} "$@"\n`, { mode: 0o700 });
  const literal = "\ufeffSnow 雪 🚀 \"quotes\" 'single' `backticks` $(never-execute) $HOME\r\nnew line\n";
  const file = join(root, "日本語 file;$(literal)`literal`.txt");
  await writeFile(file, literal);
  const item = await shareFile({ executablePath: executable, localConfigPath: config }, file);
  assert.equal(item.kind, "file");
  assert.equal(item.name, "Raycast file");
  assert.equal(item.sha256, createHash("sha256").update(literal).digest("hex"));
  assert.equal(item.byteCount, Buffer.byteLength(literal));
  await writeFile(file, "modified after immutable capture");
  const listed = JSON.parse(
    execFileSync(executable, ["list", "--local-config", config], {
      encoding: "utf8",
      env: { HOME: home, PATH: process.env.PATH },
    }),
  );
  assert.equal(listed.items[0].id, item.id);
  assert.equal(JSON.stringify(item).includes(root), false);

  // Run the real compiled copy command with an injected adapter, never the OS clipboard.
  const main = pathToFileURL(resolve("../dist/holocron-main.js")).href;
  const fixture = join(root, "injected-copy.mjs");
  const readLog = join(root, "reads");
  await writeFile(
    fixture,
    `import { appendFile } from 'node:fs/promises';
import { runHolocronCli } from ${JSON.stringify(main)};
process.exitCode = await runHolocronCli(process.argv.slice(2), { stdin: process.stdin, out: console.log, error: console.error }, {
 availability: 'test-adapter', read: async () => { await appendFile(${JSON.stringify(readLog)}, 'read\\n'); return Buffer.from(${JSON.stringify(literal)}); },
 write: async () => { throw Error('No clipboard writes'); }
});\n`,
  );
  const copy = join(root, "holocron-injected-copy");
  await writeFile(copy, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(fixture)} "$@"\n`, { mode: 0o700 });
  const text = await shareClipboard({ executablePath: copy, localConfigPath: config });
  assert.equal(text.kind, "text");
  assert.equal(text.name, "Raycast clipboard");
  assert.equal(text.sha256, item.sha256);
  assert.equal(await readFile(readLog, "utf8"), "read\n");
  const db = new DatabaseSync(join(state, "bridge.sqlite"), { readOnly: true });
  try {
    const owner = createHash("sha256")
      .update(JSON.stringify(["shared-clipboard-local-stdio-v1", process.getuid!()]))
      .digest("hex");
    for (const id of [item.id, text.id]) {
      const row = db.prepare("SELECT owner, content FROM shares WHERE id=?").get(id)!;
      assert.equal(row.owner, owner);
      assert.deepEqual(Buffer.from(row.content as Uint8Array), Buffer.from(literal));
    }
  } finally {
    db.close();
  }
});
