---
title: "Commands and limits"
description: "The public CLI, MCP tools and exact limits in one place."
order: 10
category: "Reference"
---

Holocron is the product and canonical executable. The private package is `@amxv/holocron` `0.1.1`. Its production release is `holocron-v0.1.1`, asset `holocron-0.1.1.tgz`, in the private `amxv/holocron` repository. The independent helper is available as `holocron cloud` or `holocron-cloud`. Intentional compatibility aliases are `board`, `shared-clipboard`, `shared-clipboard-probe` and `shared-clipboard-cloud`.

## Mac CLI

Run with Node `24.21.0` and npm `11.19.0`. For the primary private STDIO route, explicit local management uses `--local-config` with the strict private `{ "transport": "stdio", "stateDirectory": "/absolute/private/state" }` JSON. The alternative OAuth HTTP route uses `--config` with its separate operator JSON. Do not mix identities/state or config flags. With a dedicated install, use the recorded absolute `"$SC_NODE" "$SC_CLI"` invocation.

For direct `dist/cli.js` invocation and historical `shared-clipboard` commands that open state, the working directory must not be the state directory or any ancestor of it. Use `cd "$SC_INSTALL"` with the installed package prefix separate from state, and set the same directory for tunnel/native supervision. The `holocron` wrapper anchors to installed code automatically. `check-config` validates configuration without opening state. See [setup](getting-started.md).

| Command | Purpose |
| --- | --- |
| `--version` / `--help` | Inspect version and usage without config |
| `check-config --local-config FILE` | Validate private STDIO config without network/clipboard calls |
| `stdio --local-config FILE` | Run MCP over stdin/stdout for the official tunnel client; no public listener |
| `start --config FILE` | Run the companion in the foreground |
| `status --local-config FILE` | Query local control socket and retained-share counts |
| `stop --local-config FILE` | Stop the local companion; leave clipboard/shares/receipts intact |
| `capture --local-config FILE [--name LABEL]` | Read the Mac clipboard once into a text snapshot |
| `share-text --local-config FILE [--name LABEL]` | Share literal UTF-8 stdin |
| `share-file PATH --local-config FILE [--name LABEL]` | Capture one selected regular UTF-8 file |
| `list --local-config FILE` | List up to 20 safe share metadata records |
| `revoke SHARE_ID --local-config FILE` | Remove the owner's selected retained snapshot |
| `clear --local-config FILE` | Remove all retained shares for the owner |
| `prepare-plugin --connection-id ID --output DIRECTORY` | Create a new private plugin mapping outside the checkout |
| `login-install --config FILE` | Opt in to a generated next-login LaunchAgent |
| `login-status --config FILE` | Inspect the managed file's next-login intent |
| `login-remove --config FILE` | Remove only the exact owned login file; does not stop a current job |

Labels are 1 to 80 ASCII letters/digits/spaces/dots/underscores/hyphens, start with a letter/digit and have no trailing space. Default file label is `Context file`; source paths/basenames are not disclosed automatically.

The local management commands also support the separate HTTP `--config` route. HTTP `start`, `login-install`, `login-status` and `login-remove` continue to use `--config`; they do not manage the STDIO tunnel lifecycle. See [Secure MCP Tunnel](secure-mcp-tunnel.md) and [HTTP OAuth](phase1-setup.md).

## MCP tools

In the primary private STDIO route, authorized tunnel/workspace callers all act as one fixed local OS owner. There is no external OAuth or remote per-user isolation. Restrict access to the tunnel/connection.

For the separate HTTP route, every protected message requires the configured owner and status scope. The table lists additional **HTTP OAuth** scopes, defined by your provider.

| Tool | Additional HTTP scope | Behavior |
| --- | --- | --- |
| `get_bridge_status` | None | Owner-bound status with opaque principal; no raw subject/token |
| `read_synthetic_probe` | Read | Return a fixed harmless synthetic marker |
| `list_shared_items` | Read | List the owner's unexpired snapshots; follow `nextCursor` |
| `read_shared_item` | Read | Read by opaque ID and UTF-8 byte offset; follow `nextOffset` |
| `copy_text_to_mac` | Write | Copy literal text only on request; return a durable receipt |

Tools expose no remote Mac path selector, live Mac clipboard read, shell, URL fetch, file writing or native attachment capability. The dot can materialize exact pages using its own existing file tools after explicit authorization and full digest verification.

The pinned MCP SDK `1.32.0` uses the legacy `initialize` / `notifications/initialized` lifecycle and negotiates up to protocol `2025-11-25`. Clients using the newer `2026-07-28` protocol must use its supported legacy fallback. A `server/discover`-only client cannot establish this connection; see [tunnel mapping](secure-mcp-tunnel.md).

## Limits

| Setting | Exact value |
| --- | --- |
| Text snapshot / Mac copy / cloud clipboard | 256 KiB = 262,144 UTF-8 bytes |
| Selected file snapshot | 10 MiB = 10,485,760 bytes |
| Aggregate snapshot content | 100 MiB = 104,857,600 bytes across owners sharing a state directory |
| Snapshot lifetime | 24 hours |
| Remote read page | 4 to 65,536 UTF-8 bytes; default/maximum 65,536 |
| Remote list | Default 20; maximum 100 items per page |
| Copy request ID | 16 to 128 ASCII letters/digits/underscores/hyphens |
| New copy deadline | Future canonical UTC with milliseconds; at most five minutes ahead |
| Copy digest | Optional original 64 lowercase hexadecimal SHA-256; required by the cloud helper |
| Receipt retention | Seven days beyond completion/recovery; maximum 50,000 rows |
| HTTP access token lifetime | At most one hour |
| Cloud stdin/read/write startup deadline | Two seconds |
| Cloud ownership maximum | 30 minutes = 1,800,000 ms |
| Default HTTP listener | Loopback port 4317, MCP path `/mcp` |

The read limit covers decoded UTF-8 bytes, with JSON/MCP overhead separate. Pages may end early to preserve Unicode boundaries. Do not use character indexes as offsets. Unsupported/binary/oversize data fails without truncation or normalization.

## Friendly Holocron CLI

The [one-command installer](operations.md#one-command-cli-installation) places the absolute pinned-Node wrapper at `~/.local/bin/holocron`; custom bin/prefix paths are supported. Commands without `--config` use private STDIO config. An explicit `--config` selects the separate OAuth HTTP route and never adopts local STDIO authority.

| Command | Explicit action |
| --- | --- |
| `holocron link --local-config ABS_JSON` | Validate local config only and save its private path reference |
| `holocron init` | Create a new private config/link, refusing existing files; start nothing |
| `holocron copy [--name LABEL]` | Capture Mac clipboard text once into a snapshot |
| `holocron share [--name LABEL]` | Capture exact UTF-8 stdin to EOF |
| `holocron share-file PATH [--name LABEL]` | Snapshot the one selected UTF-8 file |
| `holocron list`, `holocron revoke ID`, `holocron clear` | List/revoke/clear retained snapshots; leave clipboards/receipts alone |
| `holocron status`, `holocron check-config` | Query local state/control or validate config only |
| `holocron stdio` | Protocol-only MCP subprocess; let the existing tunnel launch it |
| `holocron cloud probe`, `holocron cloud read`, `holocron cloud write --sha256 DIGEST [--file FILE]` | Delegate the independent Wayland helper |

For sharing/status/STDIO commands, config selection is `--local-config ABS_JSON`, then `HOLOCRON_LOCAL_CONFIG`, then legacy `BOARD_LOCAL_CONFIG`, then the saved link. Profile selection is `HOLOCRON_CLI_HOME`, then legacy `BOARD_CLI_HOME`, then `~/.config/holocron` if present, otherwise an existing `~/.config/board`, otherwise a new `~/.config/holocron`. Existing profiles are used in place without copying secrets. Cloud operations do not read profiles or Mac config. Relative selected data paths are resolved before anchoring to installed code; state beneath that code directory remains forbidden.

Shortcut contract: invoke an **absolute executable with literal argv**, e.g. `holocron copy --name "Raycast clipboard" --local-config ABS_JSON`. `copy`, `share` and `share-file` emit one JSON line with exactly `id`, `name`, `kind`, `byteCount`, `sha256`, `createdAt`, `expiresAt`. IDs are UUIDv4, digest is 64 lowercase hexadecimal SHA-256, times are canonical UTC with milliseconds, and expiry is 24 hours after capture. `copy`/`share` always return `kind: "text"`; `share-file` returns `"file"`. Empty text/files are valid. Labels are 1–80 ASCII characters: first alphanumeric, subsequent alphanumeric, spaces, dot, underscore or hyphen, with no trailing space. Output contains metadata only, never snapshot contents, source paths or credentials.

Exit codes are `0` for success, `2` for invalid arguments and `1` for operational failure. Errors use stderr; do not expose captured stdout/stderr wholesale in a shortcut UI. `holocron start --config` and login commands use only the HTTP route; `holocron stop` uses the selected local route. There is no execution command. `holocron copy` reports a shared snapshot; remote clipboard delivery requires the [original-digest receiving workflow](cloud-clipboard.md#mac-to-cloud).

## Cloud CLI

The helper requires Linux Wayland, fixed `/usr/bin/wl-copy` and `/usr/bin/wl-paste`, and the intended session's `XDG_RUNTIME_DIR`/`WAYLAND_DISPLAY`.

```sh
holocron-cloud --version
holocron-cloud --help
holocron-cloud probe
holocron-cloud write --sha256 ORIGINAL_DIGEST --file DATA_FILE
holocron-cloud read > cloud-read.json
```

`probe` reads no clipboard. `write` takes exact literal stdin or a selected regular data file, checks the original digest and holds foreground ownership after verified backend readback. `read` captures once and returns exact JSON text/byte count/digest; its framing newline is not content. Keep helper outputs private. See the full [cloud transfer workflow](cloud-clipboard.md).

## Availability and data

Local `available`, helper `candidate` and backend `owned` events each describe one layer. None proves intended Dots or viewed-desktop compatibility. Actual live setup remains **deferred and unverified** until the [private tunnel live checks](secure-mcp-tunnel.md) pass. The [HTTP OAuth route](phase1-setup.md) has separate provider/owner/scope checks.

Shares are immutable local plaintext. Expiry/revocation blocks future reads but cannot erase already returned copies. Stop/disconnect leaves the current clipboard alone. No offline delivery queue or automatic replay exists. See [operation and removal](operations.md).
