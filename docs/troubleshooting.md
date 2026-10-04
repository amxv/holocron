---
title: "Troubleshooting"
description: "Resolve installation, connection, snapshot and clipboard ownership failures."
order: 9
category: "Reference"
---

Start with local service health, then transport, then authorization. Each layer has its own lifecycle. Local status never proves intended-dot or viewed-desktop compatibility.

## The companion is unavailable

With the friendly CLI, run `holocron check-config` and `holocron status` from any directory. If configuration is unavailable, explicitly select the existing private STDIO config with `holocron link --local-config /absolute/private/local.json`. Do not run `holocron init` to replace a running setup. The executable pins its installed absolute Node path; if you remove that Node installation, reactivate Node `24.21.0` and repeat the installer. For installation failures, check existing `gh` private-repository access, the published version, asset SHA-256 and conflicting/edited executable/prefix errors in [installation](operations.md#one-command-cli-installation).

Restore the absolute paths recorded in [Mac installation](operations.md), then run:

```sh
cd "$SC_INSTALL"
"$SC_NODE" "$SC_CLI" check-config --local-config "$SC_LOCAL"
"$SC_NODE" "$SC_CLI" status --local-config "$SC_LOCAL"
```

Check Node `24.21.0` and npm `11.19.0`, private config/state permissions, and whether the official tunnel client is still running with the installed `stdio --local-config` command. The tunnel launches the STDIO companion; stop and deliberately restart its dedicated runtime when needed. Keep the Mac awake. For the alternative HTTP route, use its `--config`, foreground `start` or explicitly managed login job; a login file alone does not prove current service health.

Do not kill an unknown/reused PID or delete the database to bypass the runtime lease. Inspect conflicts before changing them. See [startup at login](operations.md#optional-startup-at-login).

## Config validation fails

The JSON must be a regular non-symlink file, mode `0600`, in a private owner-only directory outside the checkout. Use an absolute path and a normal unprivileged OS user. For STDIO, the strict JSON contains only `transport: "stdio"` and your canonical absolute private `stateDirectory`. See [private tunnel setup](secure-mcp-tunnel.md). For the alternative HTTP route, follow its [OAuth configuration](phase1-setup.md), including exact HTTPS values, three distinct scopes, token type/algorithm and canonical resource path `/mcp`.

Holocron also rejects state beneath or equal to the process's working directory. The friendly `holocron` executable anchors to installed code, keeping normal invocation independent of terminal cwd. For historical direct `shared-clipboard` commands, run the tunnel and local commands from the dedicated installed package prefix, using `cd "$SC_INSTALL"`, with state in a separate sibling directory. Launching the direct command from the state directory or a shared private parent that contains it fails this guard even when that parent is outside the Git checkout. Set the same safe working directory in any native supervisor. `check-config` does not open state, so it alone cannot detect this launch problem.

`check-config` makes no network calls. A valid schema does not establish tunnel access or intended-dot compatibility. HTTP additionally needs a compatible provider, correct callback and actual access-token contract.

## The tunnel or plugin is missing

Keep the official tunnel client running and use `tunnel-client doctor` with the exact private profile/name. Check the tunnel's Platform organization and **ChatGPT workspace** associations, plus Read/Use permissions and developer-mode eligibility.

If STDIO tools do not initialize, check the installed absolute command and `--local-config` path in the dedicated tunnel profile. It should bind `--mcp-command`, not an HTTP server URL. Keep stdout reserved for MCP protocol data. On the alternative HTTP route, check its endpoint and exact trusted OAuth discovery origins; preserve user bearer tokens. Refresh connection metadata after tool changes and retry in a fresh intended-dot conversation.

The pinned SDK negotiates legacy initialization up to MCP `2025-11-25`. Clients on the newer `2026-07-28` protocol need the official legacy fallback and must initialize before tool calls. A discovery-only request does not initialize this server. See the [tunnel guide](secure-mcp-tunnel.md) for the initialized-notification compatibility option.

The shipped plugin mapping is intentionally empty. Generate a private mapped plugin using your actual registered ID and install it in the product surface the intended dot can access. A Codex-local plugin package alone proves no cloud-dot availability. Use **Plugins → Add (+) → Create custom MCP server**, choose **Connection: Tunnel**, and select the actual tunnel or enter its ID. See [private tunnel setup](secure-mcp-tunnel.md).

## HTTP OAuth authorization is rejected

The primary private STDIO route has no external OAuth; every authorized tunnel/workspace caller shares the local owner authority. This section applies to the separate HTTP route.

Use its configured owner and provider-issued access token with the sole MCP resource audience. Check exact issuer (including a trailing slash), owner subject, signature/algorithm/type, `iat`/`exp`, optional `nbf` and all required scopes. Status is required on every protected message; reads also need read scope and copies need write scope.

Copy the callback from the actual connection management page into the provider allowlist. Do not substitute ID tokens or opaque tokens. Reconnect through the actual ChatGPT OAuth flow for an expired/revoked grant. Never paste bearer tokens into chat or logs.

## A share cannot be read

Shares expire after 24 hours and are owner-scoped. Unknown, revoked and expired IDs fail even if you kept an offset or list cursor. Capture/select again deliberately if you still want to share the current content.

Follow the returned `nextOffset`; an offset inside a multibyte UTF-8 codepoint is invalid. Verify original byte count and SHA-256 before using reconstructed data. A mismatch requires rereading/rematerializing; do not replace the expected digest with one from altered text.

## A context file is rejected

| Error | Action |
| --- | --- |
| `file_too_large` | Select a UTF-8 file at most 10 MiB |
| `storage_limit` | Revoke/clear unneeded shares; aggregate storage is 100 MiB |
| `unsupported_file` | Select one regular file, not a directory, socket, FIFO or device |
| `invalid_utf8` / `binary_file` | Supply UTF-8 text without unsupported binary controls; native PDF/image/archive attachments are unsupported |
| `file_changed` | Let the source stop changing, then select it again |
| `file_unavailable` | Check that the explicitly selected source still exists and is accessible |

File snapshots may be 10 MiB, but clipboard transfers still stop at 256 KiB. See [context files](context-files.md).

## A copy is busy, failed or uncertain

`clipboard_busy` means a different write is in progress. There is no write queue. `failed` or `uncertain` is never automatically replayed. A write handed to the OS before interruption may have changed the clipboard. Inspect it yourself, then make a deliberate new request with a fresh ID/deadline if wanted.

Exact retries of completed requests return the old receipt without replacing newer clipboard text. Reusing an ID with different text/deadline fails. A digest mismatch fails before mutation. See [text receipts](text-bridge.md#receipts-and-interruption).

## The cloud helper is unavailable

Only Linux Wayland is supported. Check the actual authorized session's absolute `XDG_RUNTIME_DIR`, `WAYLAND_DISPLAY` socket and fixed `/usr/bin/wl-copy` and `/usr/bin/wl-paste` binaries. Do not invent environment values or use another display. X11-only, Mac and Windows sessions are unsupported.

`candidate` means prerequisites exist; `clipboardAccess` and `viewedDesktop` remain unverified. After cloud replacement, install and probe again. Keep the foreground helper alive while pasting, for at most 30 minutes. Clipboard replacement/session loss or stopping it ends ownership. Use SIGINT/SIGTERM or terminate its whole managed process group; killing only the helper with SIGKILL can orphan the backend.

Readback verifies backend bytes only. Prove actual paste and explicit capture in the same viewed desktop before relying on it. See [cloud helper](cloud-clipboard.md).

## Disconnect or remove Holocron

Follow [recovery and removal](operations.md#clear-and-remove). Local stop does not revoke external tokens/tunnel keys, erase copies already returned or clear another application's clipboard. Preserve unrelated settings, plugins, jobs and files.
