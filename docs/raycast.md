---
title: Share with a Raycast shortcut
description: Install the Mac commands and assign a shortcut for clipboard or selected-file sharing.
order: 6
category: Use Holocron
---

Press a shortcut to share your copied Mac text once. Your connected agent reads that snapshot. This does not populate a remote clipboard, watch later copies or request API keys.

## Install the commands

You need macOS, Raycast, Node **24.21.0** and Bun **1.4.0** for source tooling. [Install and link Holocron](getting-started.md#connect-your-mac-for-context) first. The extension uses `~/.local/bin/holocron` by default and starts no server or tunnel.

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

## Preferences and recovery

| Preference | What to enter |
| --- | --- |
| Holocron CLI Executable | Leave blank for `~/.local/bin/holocron`, or use its full absolute executable path |
| Local Holocron Config | Leave blank for the CLI's saved link, or use the actual absolute local config path |

Do not enter `~`, shell commands, arguments, URLs or tokens in these fields. A missing CLI or invalid path points to preferences. For other failures, run `holocron status` in Terminal. A timeout may happen after a snapshot was stored; list shares before retrying.

If replacing an old Board import, record its preferences, clear its hotkey, then assign that shortcut to Holocron. Check for duplicate bindings and remove/disable the old import once the new commands work. Preferences and hotkeys do not transfer automatically.

[Text sharing](text-bridge.md) explains reading/revoking snapshots. [Remote Paste](cloud-clipboard.md) is a separate receiving operation. For private keys, use [paired requests](secret-requests.md).
