---
title: "What is Holocron?"
description: "Explicit context sharing between your Mac and ChatGPT Dots."
order: 1
category: "Start"
---

Holocron is a personal Mac companion for sharing selected text and UTF-8 context files with ChatGPT Dots. A connected dot can read those snapshots and, when you ask, copy literal text to your Mac clipboard. You paste it yourself.

[Start the setup guide](getting-started.md) to install the companion, connect your account and share your first item.

## How it fits together

| Component | Where it runs | What it does |
| --- | --- | --- |
| Mac companion | Your Mac | Captures selected context, stores snapshots and handles authorized Mac copy requests |
| Secure MCP Tunnel | Your Mac | Runs the private STDIO MCP companion and connects it through an outbound connection |
| OAuth provider, HTTP alternative | Your existing provider | Authenticates the configured owner for the separate HTTP route |
| Registered plugin | The intended ChatGPT account/workspace | Makes the companion's MCP tools available to the dot |
| Cloud helper, optional | The intended Linux Wayland session | Explicitly reads or holds literal text on that session's clipboard |
| This website | Vercel | Serves documentation only |

Keep the Mac awake and both the companion and tunnel running. Hosting this website does not run the Mac companion, connect your account or provide a clipboard relay.

The primary [private STDIO tunnel](secure-mcp-tunnel.md) needs no external OAuth provider or public listener. The companion acts as one fixed local OS owner; every authorized tunnel/workspace caller shares that authority. Restrict tunnel and workspace access accordingly. The separate [HTTP OAuth route](phase1-setup.md) retains owner and per-tool scope enforcement.

## Choose what you share

- **Text:** [Capture your Mac clipboard once](text-bridge.md) or share literal UTF-8 stdin. Later clipboard changes are not visible to the dot.
- **Files:** [Select one UTF-8 context file](context-files.md). Holocron captures a frozen copy, hides the source path and reads it in bounded pages.
- **Replies:** Ask the dot to copy a response to the Mac. The text stays literal; a completed copy does not mean a command ran.
- **Cloud clipboard:** [Install the independent helper](cloud-clipboard.md) if the actual viewed session supports Wayland. Preserve the original digest when moving bytes between computers.

## Defaults and boundaries

Text and clipboard writes are limited to **256 KiB**. Each context file can be **10 MiB**, with **100 MiB** total snapshot storage. Shares expire after **24 hours**. See the [reference](reference.md) for exact paging and request rules.

There is no clipboard watcher, automatic paste, command execution, remote live Mac clipboard read or arbitrary filesystem access. File snapshots are text context, not native attachments or ongoing path grants.

Snapshots are private local **plaintext**. Protect your OS account and backups. Revoking or clearing a share blocks future reads, but cannot erase copies already returned to a dot or another application. The bridge has no offline write queue; interrupted writes are never replayed automatically.

## Connection readiness

The implementation has local security and package checks. Actual intended Dots, private tunnel, registered plugin and viewed Mac/cloud clipboard compatibility remain **deferred and unverified**. Complete the [private tunnel setup and live checks](secure-mcp-tunnel.md) in your own account before relying on it. The alternative HTTP OAuth provider/callback/resource also need separate verification if you choose that route.
