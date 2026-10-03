---
title: "Commands and limits"
description: "The public CLI, MCP tools and exact limits in one place."
order: 10
category: "Reference"
---

Board is the public product name. Package and protocol identifiers remain compatible with the existing CLI: `@shared-clipboard/dots-probe` `0.1.0`, `shared-clipboard`, its `shared-clipboard-probe` alias, and `shared-clipboard-cloud`.

## Mac CLI

Run with Node `24.21.0` and npm `11.19.0`. For the primary private STDIO route, explicit local management uses `--local-config` with the strict private `{ "transport": "stdio", "stateDirectory": "/absolute/private/state" }` JSON. The alternative OAuth HTTP route uses `--config` with its separate operator JSON. Do not mix identities/state or config flags. With a dedicated install, use the recorded absolute `"$SC_NODE" "$SC_CLI"` invocation.

For commands that open state, the working directory must not be the state directory or any ancestor of it. Use `cd "$SC_INSTALL"` with the installed package prefix separate from state, and set the same directory for tunnel/native supervision. `check-config` validates configuration without opening state. See [setup](getting-started.md).

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

## Cloud CLI

The helper requires Linux Wayland, fixed `/usr/bin/wl-copy` and `/usr/bin/wl-paste`, and the intended session's `XDG_RUNTIME_DIR`/`WAYLAND_DISPLAY`.

```sh
shared-clipboard-cloud --version
shared-clipboard-cloud --help
shared-clipboard-cloud probe
shared-clipboard-cloud write --sha256 ORIGINAL_DIGEST --file DATA_FILE
shared-clipboard-cloud read > cloud-read.json
```

`probe` reads no clipboard. `write` takes exact literal stdin or a selected regular data file, checks the original digest and holds foreground ownership after verified backend readback. `read` captures once and returns exact JSON text/byte count/digest; its framing newline is not content. Keep helper outputs private. See the full [cloud transfer workflow](cloud-clipboard.md).

## Availability and data

Local `available`, helper `candidate` and backend `owned` events each describe one layer. None proves intended Dots or viewed-desktop compatibility. Actual live setup remains **deferred and unverified** until the [private tunnel live checks](secure-mcp-tunnel.md) pass. The [HTTP OAuth route](phase1-setup.md) has separate provider/owner/scope checks.

Shares are immutable local plaintext. Expiry/revocation blocks future reads but cannot erase already returned copies. Stop/disconnect leaves the current clipboard alone. No offline delivery queue or automatic replay exists. See [operation and removal](operations.md).
