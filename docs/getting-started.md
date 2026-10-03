---
title: "Get started"
description: "Install the Board CLI, link your private MCP setup and share your first item."
order: 2
category: "Start"
---

Board runs on your Mac and shares selected immutable snapshots with connected ChatGPT. `board copy` explicitly captures clipboard text for sharing. It does not automatically fill another computer's clipboard. For normal Paste in a connected ChatGPT computer, that computer must also have the [supported Wayland helper and an explicitly authorized transfer](cloud-clipboard.md#mac-to-cloud).

## 1. Install the CLI

Activate **Node 24.21.0** with your existing Node manager. Install GitHub CLI (`gh`) and use your existing authenticated access to the **private** `amxv/shared-clipboard` repository. After the operator publishes the release and deploys the installer:

```sh
curl -fsSL https://clipboard.ashray.xyz/install.sh | sh
"$HOME/.local/bin/board" --help
```

The installer checks the fixed release's GitHub SHA-256, installs into `~/.local/share/board-cli` and pins your absolute Node executable in `~/.local/bin/board`. It reads no existing Board config/state, touches no clipboard and starts nothing. Add `~/.local/bin` to PATH if needed; the following commands assume it is available. [Installation details](operations.md#one-command-cli-installation) cover prerequisites, inspection, custom paths, repeat installs, upgrade and failure recovery. A [source tarball installation](operations.md#pack-and-install-the-mac-companion) remains supported. No public npm publishing or anonymous private-release access is assumed.

## 2. Link your connection

If your private Secure MCP Tunnel is **already connected**, select its actual existing local config explicitly:

```sh
board link --local-config /absolute/private/Board/local.json
board status
```

`link` saves only an owner-only path reference. It validates config without opening state or restarting your tunnel. Your configuration must be a canonical absolute, non-symlink file, mode `0600`, in a private `0700` directory. `board` then works from any invocation directory. Keep your installed Node path and running tunnel available.

For a **new connection**, use:

```sh
board init
board check-config
```

This creates `~/.config/board/local.json` and a link, refusing existing files. Its fixed-owner STDIO state is `~/.config/board/state`. No HTTP listener, clipboard operation or runtime starts. Follow [Secure MCP Tunnel setup](secure-mcp-tunnel.md), binding the official tunnel client to your actual absolute executable:

```text
"/absolute/home/.local/bin/board" stdio
```

The wrapper selects your private config and anchors the subprocess to its installed code directory. Existing historical direct `shared-clipboard stdio --local-config ...` mappings remain valid and keep their documented working-directory requirements. Do not start a second runtime while a tunnel owns your state.

In the intended ChatGPT account/workspace, create or use the private Tunnel connection, then generate and install the private plugin using the actual registration ID as described in the full guide. Your account/workspace needs the relevant developer-mode and Tunnels Read + Use permissions. Every authorized private tunnel caller acts as the same fixed local owner. A local status result does not prove remote tool discovery.

## 3. Share your first item

Copy a harmless text marker yourself, then share it once:

```sh
board copy --name "First marker"
board list
```

Ask connected ChatGPT to list and read that snapshot using `list_shared_items` and `read_shared_item`. Sharing emits only safe metadata locally, never the copied text. It leaves your Mac clipboard alone. For stdin or a selected UTF-8 context file:

```sh
printf 'Hello from Board\n' | board share --name "Greeting"
board share-file ./context.txt --name "Project context"
board revoke SHARE_ID
board clear
```

Relative selected paths are resolved from your terminal's directory. Files are immutable captures with SHA-256; they grant no ongoing path access. Text remains exact, including Unicode, BOM and trailing newlines. Text is limited to 256 KiB, files to 10 MiB, total snapshots to 100 MiB, with 24-hour expiry. [Context files](context-files.md) explain bounded read pages and digest verification.

On a separate explicit request, ChatGPT can copy a literal reply to this Mac through `copy_text_to_mac`, with a unique request ID, deadline and durable receipt. Paste into a benign editor yourself. To paste the shared marker on the connected ChatGPT computer, ask ChatGPT to preserve the original digest, verify materialized bytes and explicitly run `board cloud write` in the intended supported Wayland session. Clipboard delivery requires that receiving operation; a snapshot or MCP connection alone does not establish it. No personal-computer receiver, hosted relay or automatic clipboard watcher is included.

## Other routes and next steps

The separate [HTTP OAuth setup](phase1-setup.md) retains the historical `shared-clipboard --config` route and an external provider. The friendly `board` sharing commands accept only the private STDIO local config. Keep their state/config separate; they use different owner identities.

- [Share text](text-bridge.md): explicit captures, stdin and Mac copy receipts.
- [Cloud helper](cloud-clipboard.md): optional Linux clipboard transfers with original SHA-256 verification.
- [Operations](operations.md): upgrades, private release publication, removal and live acceptance.
- [Troubleshooting](troubleshooting.md): config, transport and session failures.
- [Reference](reference.md): CLI and MCP contracts, exact limits and retained aliases.

Actual intended Dots/tool discovery and viewed Mac/cloud clipboard outcomes remain **deferred and unverified** until observed in the real installation. Tests use isolated state and injected clipboard adapters.
