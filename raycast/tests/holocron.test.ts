import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  HolocronError,
  CLI_TIMEOUT_MS,
  parseSharedItem,
  resolvePreferences,
  selectedFilePath,
  shareClipboard,
  shareFile,
} from "../src/lib/holocron";
import { receiptMessage, shareWithFeedback } from "../src/lib/feedback";

const receipt = {
  id: "78ba2541-10bd-48a1-98ea-305efaccc874",
  name: "Raycast clipboard",
  kind: "text" as const,
  byteCount: 12,
  sha256: "a".repeat(64),
  createdAt: "2026-10-04T10:00:00.000Z",
  expiresAt: "2026-10-05T10:00:00.000Z",
};

async function mockCLI(context: { after(fn: () => Promise<void>): void }, source: string) {
  const directory = await mkdtemp(join(tmpdir(), "holocron-raycast-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  // Even shell-looking executable names must remain literal filesystem paths.
  const executable = join(directory, "holocron with spaces;$(literal)`literal`");
  await writeFile(executable, `#!${process.execPath}\n${source}\n`);
  await chmod(executable, 0o700);
  return { executable, directory };
}

test("defaults to an absolute home executable without consulting config or shell PATH", () => {
  assert.deepEqual(resolvePreferences({}), { executable: join(homedir(), ".local/bin/holocron"), configArgs: [] });
});

test("preferences require absolute paths and reject control characters", () => {
  for (const path of ["holocron", "~/.local/bin/holocron", "./holocron", "/tmp/holocron\u0000", "/tmp/holocron\n"]) {
    assert.throws(() => resolvePreferences({ executablePath: path }), HolocronError);
    assert.throws(() => resolvePreferences({ localConfigPath: path }), HolocronError);
  }
  assert.deepEqual(
    resolvePreferences({ executablePath: "/tmp/holocron", localConfigPath: "/tmp/private config.json" }),
    {
      executable: "/tmp/holocron",
      configArgs: ["--local-config", "/tmp/private config.json"],
    },
  );
});

test("copy runs exactly once with fixed argv and no stdin, preserving the config path literally", async (context) => {
  const { executable } = await mockCLI(
    context,
    `const fs = require("node:fs");
     let input = "";
     process.stdin.on("data", (chunk) => input += chunk);
     process.stdin.on("end", () => {
       fs.appendFileSync(process.argv[1] + ".calls", JSON.stringify({ argv: process.argv.slice(2), input }) + "\\n");
       console.log(JSON.stringify(${JSON.stringify(receipt)}));
     });`,
  );
  const localConfigPath = join(executable + " config $(literal);`literal`", "fake.json");
  assert.deepEqual(await shareClipboard({ executablePath: executable, localConfigPath }), receipt);
  const calls = (await readFile(executable + ".calls", "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(calls, [
    { argv: ["copy", "--name", "Raycast clipboard", "--local-config", localConfigPath], input: "" },
  ]);
});

test("share-file preserves spaces, Unicode and shell text as one literal path", async (context) => {
  const fileReceipt = { ...receipt, name: "Raycast file", kind: "file" as const };
  const { executable, directory } = await mockCLI(
    context,
    `const fs = require("node:fs");
     fs.writeFileSync(process.argv[1] + ".calls", JSON.stringify(process.argv.slice(2)));
     console.log(JSON.stringify(${JSON.stringify(fileReceipt)}));`,
  );
  const filePath = join(directory, "日本語 file;$(literal)`literal`.txt");
  const config = join(directory, "config with spaces.json");
  assert.deepEqual(await shareFile({ executablePath: executable, localConfigPath: config }, filePath), fileReceipt);
  assert.deepEqual(JSON.parse(await readFile(executable + ".calls", "utf8")), [
    "share-file",
    filePath,
    "--name",
    "Raycast file",
    "--local-config",
    config,
  ]);
});

test("Finder selection rejects none, multiple and relative paths", () => {
  assert.throws(() => selectedFilePath([]), /exactly one/);
  assert.throws(() => selectedFilePath([{ path: "/tmp/a" }, { path: "/tmp/b" }]), /exactly one/);
  assert.throws(() => selectedFilePath([{ path: "relative.txt" }]), /absolute/);
  assert.equal(selectedFilePath([{ path: "/tmp/日本語 file.txt" }]), "/tmp/日本語 file.txt");
});

test("validates exact metadata schema, single JSON framing, limits, safe names and 24h expiry", () => {
  for (const ending of ["", "\n", "\r\n"]) {
    assert.deepEqual(parseSharedItem(JSON.stringify(receipt) + ending, "text"), receipt);
  }
  assert.equal(parseSharedItem(JSON.stringify({ ...receipt, byteCount: 0 }), "text").byteCount, 0);
  assert.equal(parseSharedItem(JSON.stringify({ ...receipt, byteCount: 262144 }), "text").byteCount, 262144);
  const file = { ...receipt, kind: "file" as const, byteCount: 10485760 };
  assert.equal(parseSharedItem(JSON.stringify(file), "file").byteCount, 10485760);
  const invalid: unknown[] = [
    null,
    [],
    {},
    { ...receipt, content: "PRIVATE CLIPBOARD CONTENT" },
    { ...receipt, id: "not-an-id" },
    { ...receipt, name: "unsafe\nname" },
    { ...receipt, name: "Trailing space " },
    { ...receipt, name: "a".repeat(81) },
    { ...receipt, sha256: "A".repeat(64) },
    { ...receipt, byteCount: -1 },
    { ...receipt, byteCount: 1.5 },
    { ...receipt, byteCount: "12" },
    { ...receipt, byteCount: 262145 },
    { ...receipt, kind: "file" },
    { ...receipt, createdAt: "2026-10-04T10:00:00Z" },
    { ...receipt, createdAt: "2026-02-30T10:00:00.000Z" },
    { ...receipt, expiresAt: receipt.createdAt },
    { ...receipt, expiresAt: "2026-10-05T09:59:59.000Z" },
  ];
  for (const value of invalid) assert.throws(() => parseSharedItem(JSON.stringify(value), "text"), /invalid receipt/);
  for (const output of ["not JSON", "\n" + JSON.stringify(receipt), JSON.stringify(receipt) + "\nextra\n"]) {
    assert.throws(() => parseSharedItem(output, "text"), /invalid receipt/);
  }
  assert.throws(() => parseSharedItem(JSON.stringify({ ...file, byteCount: 10485761 }), "file"), /invalid receipt/);
});

test("missing and nonexecutable CLI give installation guidance", async (context) => {
  const { executable } = await mockCLI(context, "");
  await assert.rejects(shareClipboard({ executablePath: executable + "missing" }), /CLI is missing/);
  await chmod(executable, 0o600);
  await assert.rejects(shareClipboard({ executablePath: executable }), /not executable/);
});

test("CLI operational and usage failures omit private stdout, stderr and process argv", async (context) => {
  for (const code of [1, 2]) {
    const { executable } = await mockCLI(
      context,
      `console.log("PRIVATE STDOUT"); console.error("PRIVATE STDERR"); process.exit(${code});`,
    );
    await assert.rejects(shareClipboard({ executablePath: executable }), (error: unknown) => {
      assert.ok(error instanceof HolocronError);
      assert.match(error.message, code === 1 ? /could not share/ : /rejected the request/);
      assert.doesNotMatch(error.message, /PRIVATE|literal|Command failed/);
      return true;
    });
  }
});

test("invalid and oversized successful output cannot be reported as a share success", async (context) => {
  for (const source of ["console.log('PRIVATE CONTENT')", "process.stdout.write('a'.repeat(100000))"]) {
    const { executable } = await mockCLI(context, source);
    await assert.rejects(shareClipboard({ executablePath: executable }), (error: unknown) => {
      assert.ok(error instanceof HolocronError);
      assert.doesNotMatch(error.message, /PRIVATE CONTENT|aaaaa/);
      return true;
    });
  }
});

test(
  "timeout stops the CLI and describes an uncertain outcome without retrying",
  { timeout: CLI_TIMEOUT_MS + 5000 },
  async (context) => {
    const { executable } = await mockCLI(context, "setInterval(() => {}, 1000);");
    await assert.rejects(shareClipboard({ executablePath: executable }), /may have completed/);
  },
);

test("feedback reports Holocron sharing with only metadata and captures exactly once", async () => {
  const events: string[] = [];
  let calls = 0;
  await shareWithFeedback(
    async () => {
      calls++;
      return receipt;
    },
    {
      start: async () => {
        events.push("start");
      },
      success: async (message) => {
        events.push(message);
      },
      failure: async (message) => {
        events.push("FAIL " + message);
      },
    },
  );
  assert.equal(calls, 1);
  assert.deepEqual(events, ["start", "Shared text with Holocron · 12 B · Expires in 24h"]);
  assert.doesNotMatch(events.join(" "), /Paste|clipboard ready|78ba2541|aaaaaaaa/);
  assert.match(receiptMessage({ ...receipt, byteCount: 2048 }), /2\.0 KiB/);
});

test("feedback preserves actionable Holocron errors and hides unexpected errors", async () => {
  for (const error of [new HolocronError("Holocron CLI is missing."), new Error("PRIVATE raw process command")]) {
    const events: string[] = [];
    await shareWithFeedback(
      async () => {
        throw error;
      },
      {
        start: async () => {
          events.push("start");
        },
        success: async () => {
          events.push("success");
        },
        failure: async (message) => {
          events.push(message);
        },
      },
    );
    assert.equal(events.length, 2);
    assert.doesNotMatch(events.join(" "), /PRIVATE|success/);
    if (error instanceof HolocronError) assert.equal(events[1], error.message);
  }
});

test("notification failure after success never claims the completed share failed", async () => {
  let failures = 0;
  await assert.rejects(
    shareWithFeedback(async () => receipt, {
      start: async () => {},
      success: async () => {
        throw new Error("HUD unavailable");
      },
      failure: async () => {
        failures++;
      },
    }),
    /HUD unavailable/,
  );
  assert.equal(failures, 0);
});
