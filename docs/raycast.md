---
title: Share and manage Holocron with Raycast
description: Share clipboard or Finder files, and start, stop or inspect the Mac secret-request service without Terminal.
order: 6
category: Use Holocron
---

Press a shortcut to share your copied Mac text once, or control your Holocron secret-request service directly from Raycast. Clipboard sharing does not populate a remote clipboard, watch later copies or request API keys.

## Install the commands

You need macOS, Raycast, Node **24.21.0** and Bun **1.4.0** for source tooling. [Install and link Holocron](getting-started.md#connect-your-mac-for-context) first. The extension uses `~/.local/bin/holocron` by default. Sharing commands never start a server or tunnel; the separate **Start Holocron Service** command does so only when you invoke it.

Clone the public monorepo, or use your existing checkout:

```sh
git clone https://github.com/amxv/holocron.git
cd holocron/raycast
bun install --frozen-lockfile
bun run build
bun run dev
```

Development mode imports the extension into Raycast. When it reports ready, press Control-C; the commands stay installed. To update, run `bun run dev` again from that folder. This is a local import; no store publication is needed.

## Assign your shortcut

1. Open **Raycast Settings → Extensions → Holocron**.
2. Select **Share Clipboard with Holocron**.
3. Click **Hotkey** and choose an unused shortcut.
4. Deliberately copy harmless text, then press the shortcut.

Success reports **Shared text with Holocron**, size and 24-hour expiry. Ask your connected agent to list and read the snapshot named **Raycast clipboard**. You can also search Raycast for the command without assigning a hotkey.

## Share a Finder file

Select exactly one UTF-8 file in Finder, keep Finder active, then run **Share Selected Finder File with Holocron**. Assign a separate shortcut if useful. The agent sees **Raycast file**; your clipboard stays unchanged.

Files may be at most 10 MiB. Folders, binary files and multiple selections are unsupported. Clipboard sharing accepts text up to 256 KiB, including empty text; copied images/file objects are not captured.

## Control the secret-request service

Search Raycast for any of these three commands in the Holocron extension:

| Command | Behavior |
| --- | --- |
| **Start Holocron Service** | Starts the saved Mac operator, its configured MCP tunnel and active secret-request services in the background. Safe to run again if already running. |
| **Stop Holocron Service** | Gracefully stops only the Holocron-owned operator and its children. Safe if already stopped. |
| **Holocron Service Status** | Shows whether the operator is running, tunnel readiness, and secret-service reachability. Includes **Start**, **Stop** and **Refresh Status** actions. |

Assign hotkeys to Start, Stop or Status in **Raycast Settings → Extensions → Holocron**, or simply search for them. Start is a detached process, so it survives the end of the Raycast command: you no longer need a Terminal session running `holocron start`. It does **not** configure automatic startup at Mac login. Your Mac still needs to be awake for incoming secret requests, and each request still requires native approval.

Run [Mac secret-service setup and pairing](secret-operations.md) once before using Start. Lifecycle commands deliberately invoke bare `holocron start`, `stop` and `status` against the **saved Mac operator**. The optional **Local Holocron Config** preference applies to clipboard/file sharing only; passing it to these lifecycle commands would select an unrelated legacy companion. If status indicates a stale socket, follow the explicit `holocron setup --recover` procedure in [Mac service recovery](secret-operations.md#pairing-recovery). Raycast will not remove or recover service state automatically.

The status screen now separates service health from the tunnel, secret services, pairing and remote discovery. It uses color-coded health indicators in Raycast's metadata panel and distinct paragraphs in the summary instead of collapsing all fields onto one line. Tunnel readiness and secret backend reachability are reported independently. A running operator does not prove remote MCP discovery, and Raycast does not display pairing identifiers, private paths or CLI stderr.

## Preferences and recovery

| Preference | What to enter |
| --- | --- |
| Holocron CLI Executable | Leave blank for `~/.local/bin/holocron`, or use its full absolute executable path |
| Local Holocron Config | Optional absolute config path for clipboard/file sharing. Service commands always use saved Mac setup instead |

Do not enter `~`, shell commands, arguments, URLs or tokens in these fields. A missing CLI or invalid path points to preferences. Check **Holocron Service Status** in Raycast to inspect the running operator; Mac service setup and recovery remain deliberate CLI operations. A share timeout may happen after a snapshot was stored; list shares before retrying.

If replacing an old Board import, record its preferences, clear its hotkey, then assign that shortcut to Holocron. Check for duplicate bindings and remove/disable the old import once the new commands work. Preferences and hotkeys do not transfer automatically.

[Text sharing](text-bridge.md) explains reading/revoking snapshots. [Remote Paste](cloud-clipboard.md) is a separate receiving operation. For private keys, use [paired requests](secret-requests.md).
