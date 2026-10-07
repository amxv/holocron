import { execFile, spawn } from "node:child_process";
import { CLI_TIMEOUT_MS, HolocronError, HolocronPreferences, resolvePreferences } from "./holocron";

type State = "running" | "starting" | "stopped" | "failed" | "unknown";
type Backend = "reachable" | "unavailable" | "unverified" | "unknown";
type Readiness = "ready" | "not-ready" | "unverified" | "unknown";

export interface ServiceStatus {
  runtime: "running" | "stopped";
  recoveryRequired: boolean;
  tunnel: { state: State | "configured" | "not-configured"; readiness: Readiness };
  secrets: { state: State; backend: Backend }[] | "configured" | "not-paired" | "unknown";
  pairing: "saved" | "not-paired" | "unknown";
  remoteDiscovery: "unverified" | "unknown";
}

const OUTPUT_LIMIT = 64 * 1024;
const START_DEADLINE_MS = 8_000;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function member<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === "string" && options.includes(value as T) ? (value as T) : fallback;
}

// Only known, non-sensitive health fields reach Raycast. Never display raw CLI output,
// which can contain recipient identifiers, private filesystem paths or future fields.
export function parseServiceStatus(stdout: string): ServiceStatus {
  const invalid = () => new HolocronError("Holocron returned an unrecognized service status. Update its CLI.");
  if (!/^[^\r\n]+\r?\n?$/.test(stdout)) throw invalid();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw invalid();
  }
  if (!record(parsed) || (parsed.runtime !== "running" && parsed.runtime !== "stopped")) throw invalid();

  const tunnel = record(parsed.tunnel)
    ? {
        state: member(parsed.tunnel.state, ["running", "starting", "stopped", "failed", "unknown"] as const, "unknown"),
        readiness: member(parsed.tunnel.readiness, ["ready", "not-ready", "unverified", "unknown"] as const, "unknown"),
      }
    : {
        state: member(parsed.tunnel, ["configured", "not-configured", "unknown"] as const, "unknown"),
        readiness: "unknown" as const,
      };
  const secrets = Array.isArray(parsed.secrets)
    ? parsed.secrets.slice(0, 64).map((value: unknown) => ({
        state: record(value)
          ? member(value.state, ["running", "starting", "stopped", "failed", "unknown"] as const, "unknown")
          : ("unknown" as const),
        backend: record(value)
          ? member(value.backend, ["reachable", "unavailable", "unverified", "unknown"] as const, "unknown")
          : ("unknown" as const),
      }))
    : member(parsed.secrets, ["configured", "not-paired", "unknown"] as const, "unknown");
  return {
    runtime: parsed.runtime,
    recoveryRequired: parsed.recoveryRequired === true,
    tunnel,
    secrets,
    pairing: member(parsed.pairing, ["saved", "not-paired", "unknown"] as const, "unknown"),
    remoteDiscovery: member(parsed.remoteDiscovery, ["unverified", "unknown"] as const, "unknown"),
  };
}

function cliFailure(
  action: "status" | "stop",
  error: { code?: string | number | null; killed?: boolean; signal?: string | null },
): HolocronError {
  if (error.code === "ENOENT")
    return new HolocronError("Holocron CLI is missing. Check its path in extension preferences.");
  if (error.code === "EACCES")
    return new HolocronError("Holocron CLI is not executable. Reinstall it or check permissions.");
  if (error.killed || error.signal)
    return new HolocronError(`Holocron ${action} timed out. Check status before retrying.`);
  return new HolocronError(
    `Could not ${action === "stop" ? "stop" : "inspect"} Holocron. Check the Mac setup and CLI installation.`,
  );
}

function command(preferences: HolocronPreferences, action: "status" | "stop"): Promise<string> {
  const { executable } = resolvePreferences(preferences);
  // Bare lifecycle commands address the saved Mac operator. Passing --local-config
  // would silently select the *different* legacy clipboard companion instead.
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      [action],
      { encoding: "utf8", shell: false, timeout: CLI_TIMEOUT_MS, maxBuffer: OUTPUT_LIMIT },
      (error, stdout) => (error ? reject(cliFailure(action, error)) : resolve(stdout)),
    ).stdin?.end();
  });
}

export async function serviceStatus(preferences: HolocronPreferences): Promise<ServiceStatus> {
  return parseServiceStatus(await command(preferences, "status"));
}

export async function stopService(preferences: HolocronPreferences): Promise<void> {
  const result = parseServiceStatus(await command(preferences, "stop"));
  if (result.runtime !== "stopped") throw new HolocronError("Holocron did not confirm it stopped. Check its status.");
}

function detachedStart(executable: string): Promise<() => boolean> {
  return new Promise((resolve, reject) => {
    // The CLI's start command stays in the foreground. Give it its own process
    // group and no inherited pipes so Raycast can exit without stopping it.
    const child = spawn(executable, ["start"], { detached: true, stdio: "ignore", shell: false });
    let exited = false;
    child.once("exit", () => {
      exited = true;
    });
    child.once("error", (error: NodeJS.ErrnoException) => reject(cliFailure("status", error)));
    child.once("spawn", () => {
      child.unref();
      resolve(() => exited);
    });
  });
}

export async function startService(
  preferences: HolocronPreferences,
): Promise<{ status: ServiceStatus; alreadyRunning: boolean }> {
  const before = await serviceStatus(preferences);
  if (before.runtime === "running") return { status: before, alreadyRunning: true };
  if (before.recoveryRequired) {
    throw new HolocronError("Holocron has a stale service socket. Run holocron setup --recover before starting.");
  }
  const { executable } = resolvePreferences(preferences);
  const hasExited = await detachedStart(executable);
  const deadline = Date.now() + START_DEADLINE_MS;
  while (Date.now() < deadline) {
    // Wait for the operator socket and verify that the supervisor stays alive,
    // rather than treating a successful spawn as a successful start.
    try {
      const status = await serviceStatus(preferences);
      if (status.runtime === "running") {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const verified = await serviceStatus(preferences);
        if (verified.runtime === "running") return { status: verified, alreadyRunning: false };
      }
    } catch {
      // The socket may not be ready while the new supervisor initializes.
    }
    if (hasExited()) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new HolocronError(
    "Holocron did not reach a stable running state. Check Mac setup and pairing before retrying.",
  );
}

export type HealthTone = "healthy" | "attention" | "neutral";

export interface HealthLabel {
  text: string;
  tone: HealthTone;
}

export interface ServiceOverview {
  heading: string;
  description: string;
  service: HealthLabel;
  tunnel: HealthLabel;
  secrets: HealthLabel;
  pairing: HealthLabel;
  discovery: HealthLabel;
}

/** Safe, short display values only. Never pass raw status objects to the UI. */
export function serviceOverview(status: ServiceStatus): ServiceOverview {
  const service: HealthLabel = status.recoveryRequired
    ? { text: "Recovery needed", tone: "attention" }
    : status.runtime === "running"
      ? { text: "Running", tone: "healthy" }
      : { text: "Stopped", tone: "neutral" };

  let tunnel: HealthLabel;
  if (status.tunnel.state === "not-configured") tunnel = { text: "Not configured", tone: "neutral" };
  else if (status.runtime === "stopped") tunnel = { text: "Configured", tone: "neutral" };
  else if (status.tunnel.state === "failed" || status.tunnel.readiness === "not-ready") {
    tunnel = { text: "Needs attention", tone: "attention" };
  } else if (status.tunnel.state === "running" && status.tunnel.readiness === "ready") {
    tunnel = { text: "Ready", tone: "healthy" };
  } else if (status.tunnel.state === "starting") tunnel = { text: "Starting", tone: "neutral" };
  else tunnel = { text: "Not verified", tone: "neutral" };

  let secrets: HealthLabel;
  if (!Array.isArray(status.secrets)) {
    secrets = {
      text: status.secrets === "configured" ? "Configured" : status.secrets === "not-paired" ? "Not paired" : "Unknown",
      tone: "neutral",
    };
  } else if (status.secrets.length === 0) secrets = { text: "No active services", tone: "neutral" };
  else {
    const reachable = status.secrets.filter((item) => item.state === "running" && item.backend === "reachable").length;
    const hasFailure = status.secrets.some((item) => item.state === "failed" || item.backend === "unavailable");
    secrets = {
      text: `${reachable} of ${status.secrets.length} reachable`,
      tone: hasFailure ? "attention" : reachable === status.secrets.length ? "healthy" : "neutral",
    };
  }

  const pairing: HealthLabel =
    status.pairing === "saved"
      ? { text: "Saved", tone: "healthy" }
      : { text: status.pairing === "not-paired" ? "Not paired" : "Unknown", tone: "neutral" };

  const needsAttention =
    status.recoveryRequired ||
    (status.runtime === "running" && (tunnel.tone === "attention" || secrets.tone === "attention"));
  return {
    heading: needsAttention ? "Needs attention" : status.runtime === "running" ? "Service running" : "Service stopped",
    description: status.recoveryRequired
      ? "The previous service left a stale socket. Recover it before starting Holocron again."
      : status.runtime === "stopped"
        ? "Holocron is not listening for incoming requests. Start it from the Actions menu."
        : needsAttention
          ? "The service is running, but one or more connections need attention. Check the health details."
          : "Holocron is running on your Mac. Connection health is shown on the right.",
    service,
    tunnel,
    secrets,
    pairing,
    discovery: { text: "Not verified", tone: "neutral" },
  };
}

export function serviceSummary(status: ServiceStatus): string {
  if (status.recoveryRequired) return "Holocron stopped · Recovery needed";
  if (status.runtime === "stopped") return "Holocron stopped";
  const tunnel =
    status.tunnel.state === "not-configured"
      ? "No tunnel"
      : status.tunnel.readiness === "ready"
        ? "Tunnel ready"
        : status.tunnel.readiness === "not-ready"
          ? "Tunnel not ready"
          : "Tunnel unverified";
  const secrets = Array.isArray(status.secrets)
    ? `${status.secrets.filter((item) => item.state === "running" && item.backend === "reachable").length}/${status.secrets.length} secret services reachable`
    : "Secrets unverified";
  return `Holocron running · ${tunnel} · ${secrets}`;
}

export function serviceDetails(status: ServiceStatus): string {
  const view = serviceOverview(status);
  const emoji =
    view.service.tone === "attention" || view.tunnel.tone === "attention" || view.secrets.tone === "attention"
      ? "🟠"
      : status.runtime === "running"
        ? "🟢"
        : "⚪";
  const lines = [
    "# Holocron",
    "",
    `## ${emoji} ${view.heading}`,
    "",
    view.description,
    "",
    "---",
    "",
    "### At a glance",
    "",
    `**Tunnel:** ${view.tunnel.text}`,
    "",
    `**Secret requests:** ${view.secrets.text}`,
    "",
    `**Pairing:** ${view.pairing.text}`,
    "",
    `**Remote discovery:** ${view.discovery.text}`,
    "",
  ];
  if (status.recoveryRequired) {
    lines.push("Run `holocron setup --recover` to clear the stale owned socket.", "");
  }
  lines.push(
    "---",
    "",
    "*Every secret request still requires your approval on this Mac. A running service does not confirm that remote agents can discover it.*",
  );
  return lines.join("\n");
}
