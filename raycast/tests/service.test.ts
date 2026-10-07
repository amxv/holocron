import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { lifecycleWithFeedback } from "../src/lib/feedback";
import { HolocronError } from "../src/lib/holocron";
import {
  parseServiceStatus,
  serviceDetails,
  serviceOverview,
  serviceStatus,
  serviceSummary,
  startService,
  stopService,
} from "../src/lib/service";

const running = {
  setup: "mac",
  runtime: "running",
  recoveryRequired: false,
  tunnel: { state: "running", readiness: "ready", discovery: "unverified" },
  secrets: [{ state: "running", backend: "reachable", recipient: "PRIVATE_RECIPIENT", expiresAt: 1920000000000 }],
  pairing: "saved",
  remoteDiscovery: "unverified",
};
const stopped = { setup: "mac", runtime: "stopped", tunnel: "configured", secrets: "configured" };

async function mockCLI(context: { after(fn: () => Promise<void>): void }, body: string) {
  const dir = await mkdtemp(join(tmpdir(), "holocron-raycast-service-"));
  context.after(() => rm(dir, { recursive: true, force: true }));
  const executable = join(dir, "holocron;$(literal) with spaces");
  await writeFile(executable, `#!${process.execPath}\n${body}\n`);
  await chmod(executable, 0o700);
  return { executable, dir };
}

test("service status uses only known metadata, not recipient IDs or sensitive CLI fields", () => {
  const parsed = parseServiceStatus(
    JSON.stringify({ ...running, token: "PRIVATE_TOKEN", directory: "/private/secret" }),
  );
  assert.equal(parsed.runtime, "running");
  assert.equal(parsed.tunnel.readiness, "ready");
  assert.deepEqual(parsed.secrets, [{ state: "running", backend: "reachable" }]);
  assert.match(serviceSummary(parsed), /Holocron running · Tunnel ready · 1\/1 secret services reachable/);
  const details = serviceDetails(parsed);
  assert.match(details, /## 🟢 Service running/);
  assert.match(details, /\*\*Remote discovery:\*\* Not verified/);
  assert.match(details, /\*\*Tunnel:\*\* Ready\n\n\*\*Secret requests:/);
  assert.deepEqual(serviceOverview(parsed).tunnel, { text: "Ready", tone: "healthy" });
  assert.deepEqual(serviceOverview(parsed).secrets, { text: "1 of 1 reachable", tone: "healthy" });
  assert.deepEqual(serviceOverview(parsed).discovery, { text: "Not verified", tone: "neutral" });
  assert.doesNotMatch(JSON.stringify(parsed) + details, /PRIVATE|\/private\/secret|recipient|1920000000000/);

  assert.equal(serviceSummary(parseServiceStatus(JSON.stringify(stopped))), "Holocron stopped");
  assert.match(serviceDetails(parseServiceStatus(JSON.stringify(stopped))), /\*\*Tunnel:\*\* Configured/);
  assert.match(serviceDetails(parseServiceStatus(JSON.stringify(stopped))), /Service stopped/);
  assert.match(
    serviceSummary(parseServiceStatus(JSON.stringify({ ...stopped, recoveryRequired: true }))),
    /Recovery needed/,
  );
});

test("service health distinguishes stopped, degraded, unverified and recovery states", () => {
  const stoppedView = serviceOverview(parseServiceStatus(JSON.stringify(stopped)));
  assert.deepEqual(stoppedView.service, { text: "Stopped", tone: "neutral" });
  assert.deepEqual(stoppedView.secrets, { text: "Configured", tone: "neutral" });

  const degraded = serviceOverview(
    parseServiceStatus(
      JSON.stringify({
        ...running,
        tunnel: { state: "running", readiness: "not-ready" },
        secrets: [
          { state: "failed", backend: "unavailable" },
          { state: "running", backend: "reachable" },
        ],
      }),
    ),
  );
  assert.equal(degraded.heading, "Needs attention");
  assert.deepEqual(degraded.tunnel, { text: "Needs attention", tone: "attention" });
  assert.deepEqual(degraded.secrets, { text: "1 of 2 reachable", tone: "attention" });

  const unverified = serviceOverview(
    parseServiceStatus(
      JSON.stringify({
        ...running,
        tunnel: { state: "running", readiness: "unverified" },
        secrets: [{ state: "starting", backend: "unverified" }],
      }),
    ),
  );
  assert.equal(unverified.heading, "Service running");
  assert.deepEqual(unverified.tunnel, { text: "Not verified", tone: "neutral" });
  assert.deepEqual(unverified.secrets, { text: "0 of 1 reachable", tone: "neutral" });

  const recovery = serviceOverview(parseServiceStatus(JSON.stringify({ ...stopped, recoveryRequired: true })));
  assert.equal(recovery.heading, "Needs attention");
  assert.deepEqual(recovery.service, { text: "Recovery needed", tone: "attention" });
  assert.match(
    serviceDetails(parseServiceStatus(JSON.stringify({ ...stopped, recoveryRequired: true }))),
    /setup --recover/,
  );
});

test("unknown or malformed status cannot become a false running confirmation", () => {
  for (const invalid of [
    "",
    "not JSON",
    "null",
    "[]",
    "{}",
    '{"runtime":"starting"}',
    JSON.stringify(running) + "\nPRIVATE_EXTRA_LINE",
    "\n" + JSON.stringify(running),
  ])
    assert.throws(() => parseServiceStatus(invalid), HolocronError);

  const future = parseServiceStatus(
    JSON.stringify({
      ...running,
      tunnel: { state: "secret/sensitive", readiness: "secret" },
      secrets: [{ state: "secret", backend: "secret" }],
    }),
  );
  assert.equal(future.tunnel.state, "unknown");
  assert.equal(future.tunnel.readiness, "unknown");
  assert.equal(serviceDetails(future).includes("secret/sensitive"), false);
});

test("status and stop use bare owned-operator argv, never legacy local-config or a shell", async (context) => {
  const { executable } = await mockCLI(
    context,
    `
    const fs = require('node:fs');
    fs.appendFileSync(process.argv[1] + '.calls', JSON.stringify(process.argv.slice(2)) + '\\n');
    console.log(JSON.stringify(process.argv[2] === 'status' ? ${JSON.stringify(running)} : { runtime: 'stopped' }));
  `,
  );
  const preferences = { executablePath: executable, localConfigPath: "/path with spaces/irrelevant private config" };
  assert.equal((await serviceStatus(preferences)).runtime, "running");
  await stopService(preferences);
  assert.deepEqual(
    (await readFile(executable + ".calls", "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)),
    [["status"], ["stop"]],
  );
});

test("stop rejects false acknowledgements and failure output is never shown", async (context) => {
  const { executable } = await mockCLI(
    context,
    `
    if (process.argv[2] === 'stop') console.log(JSON.stringify(${JSON.stringify(running)}));
    else console.log('PRIVATE_STATUS');
  `,
  );
  await assert.rejects(stopService({ executablePath: executable }), /did not confirm/);
  await assert.rejects(serviceStatus({ executablePath: executable }), (error: unknown) => {
    assert.ok(error instanceof HolocronError);
    assert.doesNotMatch(error.message, /PRIVATE_STATUS/);
    return true;
  });
});

test("start detaches a persistent process, verifies stable status and remains idempotent", async (context) => {
  const dir = await mkdtemp(join(tmpdir(), "holocron-raycast-lifecycle-"));
  const pidFile = join(dir, "pid");
  const callsFile = join(dir, "calls");
  context.after(async () => {
    try {
      process.kill(Number(await readFile(pidFile, "utf8")), "SIGTERM");
    } catch {
      /* may already be stopped */
    }
    await rm(dir, { recursive: true, force: true });
  });
  const executable = join(dir, "holocron with spaces;$(literal)");
  await writeFile(
    executable,
    `#!${process.execPath}
    const fs = require('node:fs');
    const pidFile = ${JSON.stringify(pidFile)};
    const callsFile = ${JSON.stringify(callsFile)};
    const action = process.argv[2];
    fs.appendFileSync(callsFile, action + '\\n');
    if (action === 'start') {
      fs.writeFileSync(pidFile, String(process.pid));
      process.on('SIGTERM', () => { try { fs.unlinkSync(pidFile); } catch {} process.exit(0); });
      setInterval(() => {}, 1000);
    } else if (action === 'status') {
      const live = fs.existsSync(pidFile);
      console.log(JSON.stringify(live ? ${JSON.stringify(running)} : ${JSON.stringify(stopped)}));
    } else if (action === 'stop') {
      if (fs.existsSync(pidFile)) {
        const pid = Number(fs.readFileSync(pidFile, 'utf8'));
        fs.unlinkSync(pidFile);
        process.kill(pid, 'SIGTERM');
      }
      console.log('{"runtime":"stopped"}');
    }
  `,
  );
  await chmod(executable, 0o700);
  const preferences = { executablePath: executable, localConfigPath: "/tmp/no-legacy-config" };
  const started = await startService(preferences);
  assert.equal(started.alreadyRunning, false);
  assert.equal(started.status.runtime, "running");
  const repeated = await startService(preferences);
  assert.equal(repeated.alreadyRunning, true);
  await stopService(preferences);
  assert.equal((await serviceStatus(preferences)).runtime, "stopped");
  await stopService(preferences); // Idempotent; stopping a stopped service is safe.
  assert.equal(
    (await readFile(callsFile, "utf8"))
      .trim()
      .split("\n")
      .filter((call) => call === "start").length,
    1,
  );
});

test("failed background start does not report success or reveal its stderr", async (context) => {
  const { executable } = await mockCLI(
    context,
    `
    if (process.argv[2] === 'start') { console.error('PRIVATE_KEY_FROM_CHILD'); process.exit(1); }
    console.log(JSON.stringify(${JSON.stringify(stopped)}));
  `,
  );
  await assert.rejects(startService({ executablePath: executable }), (error: unknown) => {
    assert.ok(error instanceof HolocronError);
    assert.match(error.message, /did not reach a stable running state/);
    assert.doesNotMatch(error.message, /PRIVATE_KEY_FROM_CHILD/);
    return true;
  });
});

test("lifecycle feedback reports success only after the operation and sanitizes failures", async () => {
  const events: string[] = [];
  const feedback = {
    start: async () => {
      events.push("start");
    },
    success: async (message: string) => {
      events.push(message);
    },
    failure: async (message: string) => {
      events.push("FAIL " + message);
    },
  };
  await lifecycleWithFeedback(async () => "Holocron stopped", feedback);
  await lifecycleWithFeedback(async () => {
    throw new Error("PRIVATE_TOKEN");
  }, feedback);
  assert.deepEqual(events, [
    "start",
    "Holocron stopped",
    "start",
    "FAIL Could not control Holocron. Check its CLI and Mac setup.",
  ]);
});
