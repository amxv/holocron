import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export interface HolocronPreferences {
  executablePath?: string;
  localConfigPath?: string;
}

export interface SharedItem {
  id: string;
  name: string;
  kind: "text" | "file";
  byteCount: number;
  sha256: string;
  createdAt: string;
  expiresAt: string;
}

export class HolocronError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HolocronError";
  }
}

export const CLI_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const ITEM_KEYS = ["id", "name", "kind", "byteCount", "sha256", "createdAt", "expiresAt"];
const TEXT_LIMIT = 256 * 1024;
const FILE_LIMIT = 10 * 1024 * 1024;

function absolutePath(value: string, title: string): string {
  if (
    !isAbsolute(value) ||
    Array.from(value).some((character) => character.charCodeAt(0) < 32 || character === "\u007f")
  ) {
    throw new HolocronError(`${title} must be an absolute path. Check Holocron extension preferences.`);
  }
  return value;
}

export function resolvePreferences(preferences: HolocronPreferences): { executable: string; configArgs: string[] } {
  const executable = absolutePath(
    preferences.executablePath || join(homedir(), ".local", "bin", "holocron"),
    "Holocron CLI",
  );
  const configArgs = preferences.localConfigPath
    ? ["--local-config", absolutePath(preferences.localConfigPath, "Local Holocron config")]
    : [];
  return { executable, configArgs };
}

function isCanonicalDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

export function parseSharedItem(stdout: string, expectedKind: SharedItem["kind"]): SharedItem {
  const invalidResponse = () =>
    new HolocronError("Holocron returned an invalid receipt. Update the Holocron CLI before retrying.");
  // Accept one JSON line with an optional framing newline, never copied content or logging.
  if (!/^[^\r\n]+\r?\n?$/.test(stdout)) throw invalidResponse();
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw invalidResponse();
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidResponse();
  const item = value as Record<string, unknown>;
  const keys = Object.keys(item);
  if (keys.length !== ITEM_KEYS.length || !ITEM_KEYS.every((key) => keys.includes(key))) throw invalidResponse();
  if (
    typeof item.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.id) ||
    typeof item.name !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/.test(item.name) ||
    item.name.trim() !== item.name ||
    item.kind !== expectedKind ||
    typeof item.byteCount !== "number" ||
    !Number.isSafeInteger(item.byteCount) ||
    item.byteCount < 0 ||
    item.byteCount > (expectedKind === "text" ? TEXT_LIMIT : FILE_LIMIT) ||
    typeof item.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(item.sha256) ||
    !isCanonicalDate(item.createdAt) ||
    !isCanonicalDate(item.expiresAt) ||
    Date.parse(item.expiresAt) - Date.parse(item.createdAt) !== DAY_MS
  ) {
    throw invalidResponse();
  }
  return item as unknown as SharedItem;
}

function runHolocron(
  preferences: HolocronPreferences,
  args: string[],
  expectedKind: SharedItem["kind"],
): Promise<SharedItem> {
  const { executable, configArgs } = resolvePreferences(preferences);
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      [...args, ...configArgs],
      { encoding: "utf8", shell: false, timeout: CLI_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES },
      (error, stdout) => {
        if (error) {
          // Error.message can embed argv, stdout and stderr. Never display or log it.
          if (error.code === "ENOENT") {
            reject(
              new HolocronError(
                "Holocron CLI is missing. Install it, or set its absolute path in extension preferences.",
              ),
            );
          } else if (error.code === "EACCES") {
            reject(new HolocronError("Holocron CLI is not executable. Reinstall it or check its file permissions."));
          } else if (error.killed || error.signal) {
            reject(
              new HolocronError(
                "Holocron did not finish. The share may have completed; check Holocron before retrying.",
              ),
            );
          } else if (error.code === 2) {
            reject(new HolocronError("Holocron rejected the request. Update the CLI and check extension preferences."));
          } else {
            reject(
              new HolocronError(
                "Holocron could not share. Check its local configuration with holocron status in Terminal.",
              ),
            );
          }
          return;
        }
        try {
          resolve(parseSharedItem(stdout, expectedKind));
        } catch (error) {
          reject(error);
        }
      },
    ).stdin?.end();
  });
}

export function shareClipboard(preferences: HolocronPreferences): Promise<SharedItem> {
  return runHolocron(preferences, ["copy", "--name", "Raycast clipboard"], "text");
}

export function selectedFilePath(items: { path: string }[]): string {
  if (items.length !== 1) {
    throw new HolocronError("Select exactly one UTF-8 file in Finder, then run this command again.");
  }
  return absolutePath(items[0].path, "Selected Finder file");
}

export function shareFile(preferences: HolocronPreferences, path: string): Promise<SharedItem> {
  return runHolocron(
    preferences,
    ["share-file", absolutePath(path, "Selected Finder file"), "--name", "Raycast file"],
    "file",
  );
}
