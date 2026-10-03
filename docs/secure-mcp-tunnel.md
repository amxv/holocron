---
title: Secure MCP Tunnel
description: Connect Board directly to an existing private OpenAI tunnel over STDIO.
order: 3
category: Start
---

Board can be launched directly by your existing OpenAI Secure MCP Tunnel as a local STDIO MCP subprocess. This private transport needs no external OAuth provider. Board opens no HTTP listener in this mode. Shared text, selected UTF-8 files and literal Mac clipboard writes use the same bounds and durable receipts as the OAuth HTTP companion.

## Trust and access

STDIO authority comes from explicit execution as an unprivileged OS user, private owner-only configuration/state, and authorized private tunnel/workspace access. **Every caller allowed to use that tunnel acts as the same fixed local owner.** There is no remote per-person identity or scope separation in STDIO, and client-supplied identity/token metadata cannot choose another owner. Authorize the tunnel only for people who should be able to read your explicitly shared snapshots and request literal clipboard writes.

STDIO tool metadata declares `noauth` because this subprocess has no separate application OAuth exchange. The tunnel still requires its own runtime credential and authorized organization/workspace access. Board neither configures nor validates those credentials. Requests, shared content and responses travel through OpenAI. A private tunnel is not an offline/local-only data path.

The distinct `--config` HTTP transport retains its OAuth JWT owner/resource/scope checks on every request. A local config cannot start HTTP, and an HTTP config cannot start STDIO. There is no unauthenticated HTTP option. The local owner is separate from an OAuth owner; use a separate private state directory. Existing OAuth snapshots do not silently become local STDIO shares.

## Install the private package

Activate Node `24.21.0` and npm `11.19.0`. From a checked-out Board repository:

```sh
npm ci
npm run check
npm pack --pack-destination /absolute/private/artifacts
npm install --prefix /absolute/private/board --omit=dev --ignore-scripts \
  /absolute/private/artifacts/shared-clipboard-dots-probe-0.1.0.tgz
```

Create the artifact/install directories first. This package is private; use the local tarball, not public npm publication. The installed CLI is `/absolute/private/board/node_modules/@shared-clipboard/dots-probe/dist/cli.js`. Pin an absolute Node executable so a managed tunnel does not depend on an interactive shell or a version manager shim. The executable `shared-clipboard` is also installed under the prefix's `node_modules/.bin`.

## Configure Board

Keep both config and state outside the repository. Config must be a regular non-symlink file with mode `0600`, in a same-owner private directory with mode `0700`. Its canonical absolute path must have no symlink ancestors. State must be canonical, owned by the same unprivileged OS user, mode `0700`, with safe ancestors; Board creates missing state directories and an owner-only SQLite database. Root execution is refused.

Create a UTF-8 JSON file such as `/absolute/private/Board/local.json` with exactly:

```json
{
  "transport": "stdio",
  "stateDirectory": "/absolute/private/Board/state"
}
```

No issuer, subject, token, tunnel key, port, command or owner override is accepted. Check its shape without starting a listener or reading any clipboard:

```sh
/absolute/node /absolute/private/board/node_modules/@shared-clipboard/dots-probe/dist/cli.js \
  check-config --local-config /absolute/private/Board/local.json
```

The direct MCP executable contract is:

```sh
/absolute/node /absolute/private/board/node_modules/@shared-clipboard/dots-probe/dist/cli.js \
  stdio --local-config /absolute/private/Board/local.json
```

Let the MCP client launch it. Do not start a standalone second Board runtime while the tunnel owns it. STDIO stdout contains only newline-delimited MCP JSON-RPC, never startup banners or management output. Errors go to stderr as generic safe codes, without paths, request text or credentials. STDIO accepts the SDK's initialization lifecycle, negotiating up to MCP `2025-11-25`; it does not implement the newer `2026-07-28` discovery protocol. Clients supporting newer MCP must use the documented legacy initialization fallback.

## Map the existing tunnel to Board

The supported mapping is a `main` command binding. Use absolute executable/config paths, quoting each path containing spaces inside the command string. Never place credentials in this string. An example command string is:

```text
"/absolute/node" "/absolute/private/board/node_modules/@shared-clipboard/dots-probe/dist/cli.js" stdio --local-config "/absolute/private/Board/local.json"
```

For a new named profile attached to your existing tunnel, using the runtime credential reference already provisioned for your installation:

```sh
tunnel-client init --sample sample_mcp_stdio_local --profile board-stdio \
  --tunnel-id YOUR_EXISTING_TUNNEL_ID \
  --control-plane-api-key-ref env:CONTROL_PLANE_API_KEY \
  --health-listen-addr 127.0.0.1:0 \
  --mcp-command '"/absolute/node" "/absolute/private/board/node_modules/@shared-clipboard/dots-probe/dist/cli.js" stdio --local-config "/absolute/private/Board/local.json"'
tunnel-client doctor --profile board-stdio --explain
tunnel-client run --profile board-stdio
```

Use your existing `file:/absolute/private/key-file` reference in place of the environment reference if that is how the credential is provisioned. Reuse your existing profile's control-plane URL, organization/workspace associations and credential reference as appropriate. Avoid overwriting an unrelated profile. Do not print, copy into Board JSON or commit the key.

For an existing profile, the equivalent MCP portion is:

```yaml
mcp:
  commands:
    - channel: main
      command: '"/absolute/node" "/absolute/private/board/node_modules/@shared-clipboard/dots-probe/dist/cli.js" stdio --local-config "/absolute/private/Board/local.json"'
```

Replace that profile's `main` HTTP target rather than retaining a second conflicting main binding. `--mcp.command` is the run flag; `--mcp-command` is the init/runtimes flag; `MCP_COMMAND` is the environment equivalent. Do not use `MCP_SERVER_URL` or the companion's OAuth `/mcp` route for this STDIO mapping. Initialize and send `notifications/initialized` before tool calls. For a caller that initializes but omits the notification, the official client supports opt-in `--mcp.stdio-send-initialized-notification` on `run` (YAML `mcp.stdio_send_initialized_notification: true`); normal MCP SDK clients already send it.

For a long-lived installation managed by the tunnel client, use its native supervision instead of shell backgrounding:

```sh
tunnel-client runtimes connect --alias board --profile board-stdio \
  --tunnel-id YOUR_EXISTING_TUNNEL_ID \
  --runtime-api-key env:CONTROL_PLANE_API_KEY \
  --mcp-command '"/absolute/node" "/absolute/private/board/node_modules/@shared-clipboard/dots-probe/dist/cli.js" stdio --local-config "/absolute/private/Board/local.json"'
tunnel-client runtimes status board --json
```

Choose either foreground `run` or a managed runtime. Stop any previous instance for the tunnel before switching: multiple active tunnel clients sharing a tunnel ID with STDIO are unsupported. Board's runtime lease also refuses a second process against the same state. For a managed runtime, report it ready only after the native status command confirms process/health/readiness. Transport readiness alone does not prove tool discovery; the client can report STDIO discovery `not_observed` until a call is actually forwarded. Review the installed client's `--help` for supported flags.

## Connect and share

While the tunnel is healthy, open **ChatGPT Plugins → Add (+) → Create custom MCP server**, choose **Tunnel** under connection and select the existing authorized tunnel. Workspace labels and access can differ. The tunnel must be associated with the target ChatGPT workspace and Platform organization, and the caller needs Tunnels Read + Use. No Board OAuth provider fields are needed for this private subprocess. Begin with `get_bridge_status` and `read_synthetic_probe`, which contain no personal shared data.

After ChatGPT creates the connection, copy its actual technical ID from the browser URL; it begins with `plugin_asdk_app_`. To install Board as a private mapped plugin on a supported Work/Codex surface, generate a fresh package outside the repository in an owner-only private parent:

```sh
/absolute/node /absolute/private/board/node_modules/@shared-clipboard/dots-probe/dist/cli.js \
  prepare-plugin --connection-id ACTUAL_REGISTERED_ID --output /absolute/private/new-board-plugin
```

This writes private `plugin.json` and `.app.json` files, mode `0600`, in a new `0700` directory. It maps `apps.shared-clipboard-probe.id` to the registered connection, validates ID syntax only, and never edits marketplaces or Codex settings. The shipped mapping is empty. Keep the actual ID only in that generated private package; credentials belong to the tunnel client.

Install/enable the generated plugin in the actual product surface that the intended dot can use. For supported local marketplaces, follow [private local marketplace installation](phase1-setup.md#private-local-marketplace-where-supported), using the registered STDIO connection's ID and the same `prepare-plugin` command. Those packaging steps do not require an OAuth provider for STDIO. Surface availability varies: a Codex-local marketplace does not establish cloud-dot access. Refresh the custom MCP server's tools after updates, enable the plugin and start a fresh conversation to verify discovery. Private tunnels are not a public plugin-submission path.

Use the same installed CLI and local config for explicit sharing:

```sh
shared-clipboard capture --local-config /absolute/private/Board/local.json --name "Copied text"
shared-clipboard share-text --local-config /absolute/private/Board/local.json --name "Shared text"
shared-clipboard share-file /absolute/path/to/context.txt \
  --local-config /absolute/private/Board/local.json --name "Project context"
shared-clipboard list --local-config /absolute/private/Board/local.json
shared-clipboard revoke SHARE_ID --local-config /absolute/private/Board/local.json
shared-clipboard clear --local-config /absolute/private/Board/local.json
shared-clipboard status --local-config /absolute/private/Board/local.json
```

`capture` explicitly reads the Mac clipboard. `share-text` accepts literal UTF-8 stdin until EOF. `share-file` snapshots one selected regular UTF-8 file; it grants no ongoing path access. Management emits safe metadata only. The cloud helper remains independently installed and has no tunnel credentials. [Text and receipts](text-bridge.md), [context files](context-files.md) and [cloud clipboard](cloud-clipboard.md) explain literal bytes and digest verification.

## Bounds, shutdown and recovery

Text capture/share/write remains 256 KiB; selected UTF-8 files 10 MiB; aggregate snapshots 100 MiB; read pages 64 KiB; fixed share expiry 24 hours. STDIO frames allow at most `6 × 256 KiB + 16 KiB` bytes for escaped JSON and overhead, with 16 outstanding RPCs and four frames' worth of pending output. Malformed JSON, invalid UTF-8, batches, duplicate in-flight IDs, excessive frames/concurrency or output close fail the subprocess without logging payloads. Well-formed invalid tool arguments return protocol errors without dispatching clipboard writes. Clients should limit parallel requests and keep reading stdout.

EOF, SIGINT, SIGTERM and owner-only `stop --local-config ...` cancel in-flight writes, record their safe receipt outcome, close the private control socket and release the runtime lease. An interrupted or forcibly killed write recovers as uncertain, never auto-replays. Exact retries return the original completed/failed/uncertain receipt; new intentional writes require fresh IDs/deadlines. Stop/revoke/clear leave the current clipboard alone. Stopping Board also breaks the tunnel child connection; stop/reconnect the tunnel through its own supervision for continued operation. The optional OAuth HTTP login-start commands do not accept `--local-config`; manage this runtime with the tunnel client.

Local SDK subprocess and clean installed-package tests establish framing, sharing, metadata, bounds, restart/idempotency and failure behavior. Actual ChatGPT/tunnel discovery, intended Dots, sleep/wake and viewed Mac/cloud clipboard operations remain **deferred and unverified** until observed in the real installation.

Sources: [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels), [official tunnel onboarding](https://github.com/openai/tunnel-client/blob/master/docs/onboarding.md), [configuration and STDIO deployment limits](https://github.com/openai/tunnel-client/blob/master/docs/configuration.md), [MCP STDIO framing and shutdown](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio), [MCP authorization transport boundary](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization), and [official SDK release lines](https://github.com/modelcontextprotocol/typescript-sdk). Checked alongside installed tunnel-client `0.0.14` help on October 4, 2026.
