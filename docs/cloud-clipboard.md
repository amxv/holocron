---
title: Paste on the receiving computer
description: Explicitly transfer clipboard text in a supported Linux Wayland session.
order: 7
category: Use Holocron
---

Sharing a Holocron snapshot does **not** fill the other computer's clipboard. For normal Paste, explicitly ask your agent to transfer it using the independent helper in that computer's intended graphical session. API keys use [private requests](secret-requests.md), never this helper.

## Install and check the session

[Install Holocron](getting-started.md#install-holocron) on the receiving computer with Node **24.21.0** from the public GitHub release. It needs no Mac config, tunnel key or relay admin credential. Run:

```sh
holocron cloud probe
```

The supported backend is **Linux Wayland** with fixed `/usr/bin/wl-copy` and `/usr/bin/wl-paste` from `wl-clipboard`. Use your approved OS package workflow to install it. X11-only sessions, macOS and Windows are unsupported.

Run in the actual session's authorized environment with its `XDG_RUNTIME_DIR` and `WAYLAND_DISPLAY`. Do not invent values or guess a desktop. `probe` reads no clipboard. `candidate` means the socket and binaries exist; `clipboardAccess` and `viewedDesktop` remain `unverified`. Test a harmless paste in the viewed session before relying on it. Actual viewed clipboard compatibility is **deferred and unverified** until observed.

## Mac to cloud

Share on the Mac with `holocron copy`, then give your agent this task:

```text
Use Holocron to read my selected snapshot and copy it to this computer's
clipboard. Preserve exact structured pages, follow nextOffset and verify
the original byte count and SHA-256. Save verified bytes as a data file.
Use holocron cloud write with that file and the original snapshot digest.
Keep its foreground process running while I paste in the viewed session.
Do not execute the text. Report if the session is unsupported.
```

The agent must preserve exact returned `text`, including BOM and newlines. [File materialization](context-files.md#save-an-exact-copy-on-the-receiving-computer) shows page verification; for a text snapshot use `kind: "text"` instead of `"file"`. A mismatch requires rereading, not changing the expected digest.

With a verified data file and its **original** 64-character lowercase digest:

```sh
holocron cloud write --sha256 ORIGINAL_DIGEST --file DATA_FILE
```

Replace both placeholders. The helper verifies bytes before mutation, then reports `state: "owned"` only after matching backend readback. Keep it in a foreground terminal or authorized managed task while you paste. `owned` does not prove viewed-desktop identity or execution.

Clipboard text is limited to **256 KiB**. Unsupported binary controls, invalid UTF-8, changed input or oversize text fail without truncation. Larger context snapshots remain readable but cannot use this clipboard path.

## Cloud to Mac

Only when you ask to capture this session's clipboard and copy it to the Mac:

```sh
umask 077
holocron cloud read > cloud-read.json
```

The result contains exact `text`, `byteCount` and original `sha256`. It is sensitive text, not a general log. Use the agent's existing data tools to verify and construct literal MCP arguments:

```python
import hashlib, json, uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

capture = json.loads(Path("cloud-read.json").read_text(encoding="utf-8"))
content = capture["text"].encode("utf-8")
assert len(content) <= 256 * 1024 and len(content) == capture["byteCount"]
assert hashlib.sha256(content).hexdigest() == capture["sha256"]
request = {
    "request_id": str(uuid.uuid4()),
    "text": capture["text"],
    "expected_sha256": capture["sha256"],
    "valid_until": (datetime.now(timezone.utc) + timedelta(minutes=1))
        .isoformat(timespec="milliseconds").replace("+00:00", "Z"),
}
Path("copy-request.json").write_text(json.dumps(request), encoding="utf-8")
```

Pass that exact object to `copy_text_to_mac` through your connected tool surface. If it cannot preserve exact structured data, report transfer unavailable. Model transcription with a new digest is not verification. On a completed receipt, paste into a benign Mac editor yourself. `failed` or `uncertain` requires a deliberate fresh request, never automatic replay.

## Ownership and stopping

`write` holds a foreground `wl-copy` process. Ownership ends on replacement, session loss, SIGINT/SIGTERM or the fixed 30-minute maximum. Stop gracefully; SIGKILL of only the helper can orphan its worker. Stopping never clears another application's clipboard, but its own offered bytes may disappear. Clipboard-manager persistence is not promised.

There is no network client, clipboard watcher, automatic paste or offline replay in this helper. A replacement computer/session must be installed and probed again. `holocron-cloud` remains an equivalent standalone executable. See [limits](reference.md) and [troubleshooting](troubleshooting.md).
