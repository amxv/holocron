---
title: "Get started"
description: "Install the Mac companion, connect a private MCP tunnel and share your first item."
order: 2
category: "Start"
---

Set up Board in three stages: install on your Mac, connect Secure MCP Tunnel, then explicitly share context. The companion stays on the Mac; this documentation site is static.

## Before you begin

You need a Mac, a source checkout or privately supplied package artifact, **Node 24.21.0 and npm 11.19.0**, access to the intended ChatGPT account/workspace, developer-mode eligibility and Secure MCP Tunnel permissions.

The primary private STDIO route has no public listener and needs no external OAuth provider. All authorized tunnel/workspace callers share the companion's fixed local OS-owner authority. Restrict who can use the tunnel and registered connection; this route does not isolate remote users from one another.

Board is distributed as a **private tarball**, not a public npm install. The package name remains `@shared-clipboard/dots-probe`; the commands remain `shared-clipboard` and `shared-clipboard-cloud`.

## 1. Install on your Mac

Follow [Mac companion installation](operations.md#pack-and-install-the-mac-companion). It builds and installs into a dedicated prefix outside your checkout. Record the absolute paths, using your existing Node manager. With mise:

```sh
SC_INSTALL="$HOME/Library/Application Support/shared-clipboard-package"
SC_PRIVATE="$HOME/Library/Application Support/shared-clipboard-operator"
SC_NODE="$(mise where node@24.21.0)/bin/node"
SC_CLI="$SC_INSTALL/node_modules/@shared-clipboard/dots-probe/dist/cli.js"
SC_LOCAL="$SC_PRIVATE/local.json"
```

These variables assume the dedicated directories already exist from the full install guide. In a fresh terminal, restore them before using the following commands. With another manager, use its absolute Node executable after confirming the pinned version.

## 2. Connect the private tunnel

Follow [Secure MCP Tunnel setup](secure-mcp-tunnel.md). Create the private local JSON, mode `0600` in an owner-only `0700` directory outside the checkout:

```json
{
  "transport": "stdio",
  "stateDirectory": "/absolute/private/shared-clipboard-state"
}
```

Choose your actual canonical absolute private state directory. The placeholder above is not an installation-specific path. Check the configuration:

```sh
"$SC_NODE" "$SC_CLI" check-config --local-config "$SC_LOCAL"
```

Bind the official tunnel client to the **installed absolute STDIO command**:

```text
ABS_NODE ABS_INSTALLED_CLI stdio --local-config ABS_PRIVATE_JSON
```

The tunnel client launches this command and carries MCP over stdin/stdout. Before running it, change into the dedicated installed package prefix, which is separate from the private state directory:

```sh
cd "$SC_INSTALL"
```

Do not launch the tunnel from the private state directory or any ancestor of it. Board rejects state beneath or equal to the process's working directory, including a shared private parent. Keep the package prefix and state as separate sibling directories. Follow the full guide's `tunnel-client run` command from this package directory. Set this same working directory when configuring a native supervisor.

Do not separately launch the companion as an HTTP service or pass a server URL for this route. Keep the tunnel client running, the Mac awake and the installed paths stable. The complete guide covers the exact tunnel profile, permissions and lifecycle.

In the intended ChatGPT account, use **Plugins → Add (+) → Create custom MCP server**, choose **Connection: Tunnel**, then select the actual tunnel or enter its ID. Generate and install the private plugin using the actual registration ID as described in the tunnel guide. A package installation or local status does not establish actual Dots access.

## 3. Share your first item

In a second terminal, restore the recorded variables, change into the package prefix again and select a harmless UTF-8 text file. Every local command that opens state needs this safe working directory:

```sh
cd "$SC_INSTALL"
"$SC_NODE" "$SC_CLI" share-file /absolute/path/to/context.txt \
  --local-config "$SC_LOCAL" --name "Project context"
"$SC_NODE" "$SC_CLI" list --local-config "$SC_LOCAL"
```

Ask your connected dot: “List the items I shared, then read Project context and summarize it.” It uses `list_shared_items` and `read_shared_item`, following UTF-8 byte offsets until complete. It cannot select new Mac paths remotely.

For clipboard text, copy a harmless marker yourself, then run:

```sh
"$SC_NODE" "$SC_CLI" capture --local-config "$SC_LOCAL" --name "First marker"
```

Ask the dot to read that snapshot. On a separate explicit request, it can copy literal text back through `copy_text_to_mac`. Paste into a benign editor to verify it before deciding to execute anything.

## Other routes and next steps

The separate [HTTP OAuth setup](phase1-setup.md) uses `--config`, a compatible external provider and per-tool scopes. Its `start` and optional login commands remain available. Keep HTTP and STDIO state/config separate; they use different owner identities. Use the route's matching config flag consistently.

- [Share text](text-bridge.md): explicit captures, stdin and Mac copy receipts.
- [Context files](context-files.md): immutable captures, bounded paging and digest-verified materialization.
- [Cloud helper](cloud-clipboard.md): optional Linux clipboard transfers with original SHA-256 verification.
- [Troubleshooting](troubleshooting.md): service health, connection failures and interrupted writes.
- [Commands and limits](reference.md): both transport contracts and exact bounds.

Actual intended account, tunnel, plugin and viewed clipboard checks remain **deferred and unverified** until you complete the live steps in the [private tunnel guide](secure-mcp-tunnel.md).
