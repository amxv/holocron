---
title: Cloud clipboard helper
description: Install and operate the independent Linux Wayland clipboard helper.
order: 8
category: Use Holocron
---

The independent helper works with [private STDIO tunnel](secure-mcp-tunnel.md) or OAuth HTTP Holocron connections. Private STDIO callers share the local owner authority. The helper receives no tunnel/provider credentials and is installed separately in the selected cloud graphical session.

`holocron-cloud` is an optional, independent Linux helper. It has no network client, OAuth/tunnel configuration, tokens, automatic installation, clipboard watcher, keyholocron events or command execution. Existing Mac clipboard and context tools work without it. Standard backend support and local injected-process tests are implemented. **Actual intended Dots, provider/tunnel and viewed graphical clipboard compatibility are deferred and unverified.**

## Install and probe explicitly

With existing authenticated `gh` read access to the private Holocron repository, the [one-command installer](operations.md#one-command-cli-installation) also runs in supported Linux helper contexts. It requires Node `24.21.0`, downloads the verified private production bundle, and needs no Mac/operator/tunnel config. After publication and installer deployment:

```sh
curl -fsSL https://holocron.ashray.xyz/install.sh | sh
"$HOME/.local/bin/holocron" cloud probe
```

Use `holocron cloud read` or `holocron cloud write --sha256 ORIGINAL_DIGEST --file DATA_FILE` for the same literal formats and foreground ownership contract below. `holocron cloud` never reads the CLI profile or Mac config. A helper install provides no automatic pairing, share download or clipboard delivery. If this computer has no private repository access, the operator can explicitly provide the verified private artifact through an already-authorized private transfer; do not export Mac tunnel credentials or make the source public. The source/tarball route remains available:

Use the same built package artifact as the Mac companion, with Node `24.21.0` and npm `11.19.0`. For a local artifact named `amxv-holocron-0.1.1.tgz`, install it explicitly on the cloud computer:

```sh
umask 077
SC_CLOUD="$HOME/.local/share/holocron-helper"
# Use a fresh dedicated prefix; create its parent first if missing.
mkdir "$SC_CLOUD"
npm install --prefix "$SC_CLOUD" --omit=dev --ignore-scripts ./amxv-holocron-0.1.1.tgz
SC_HELPER="$SC_CLOUD/node_modules/.bin/holocron-cloud"
"$SC_HELPER" --version
"$SC_HELPER" --help
"$SC_HELPER" probe
```

The artifact must already contain `dist`; build/pack in the source checkout with `npm run ci:all`, `npm run check`, and `npm pack`. This is independent of plugin registration. Neither the plugin nor this helper installs the other or grants graphical-session access.

Activate exactly the pinned Node/npm before these commands. Subsequent examples use `holocron-cloud` for readability: substitute the recorded absolute `"$SC_HELPER"` or deliberately add only this dedicated bin directory to your task PATH. Never transfer the Mac operator configuration, generated connection mapping, tunnel profile/key or OAuth credentials with the tarball. For removal, gracefully stop the helper first, then `npm uninstall --prefix "$SC_CLOUD" --ignore-scripts @amxv/holocron`; preserve unrelated packages/task files and remove directories only if empty. [Private operations](operations.md) covers the separate Mac/plugin/tunnel lifecycle and live acceptance.

The single supported backend is Wayland `wl-clipboard`, using fixed `/usr/bin/wl-copy` and `/usr/bin/wl-paste`. Install that standard package through the cloud image's approved OS package workflow if needed, then start the helper in the intended graphical session's authorized task environment. Both executables must support `--type`; copy must support `--foreground`, and paste `--no-newline`. No custom executable selector or PATH search exists. X11-only sessions, macOS and Windows are unsupported. A distribution installing elsewhere needs an explicit implementation adaptation, not a command override.

Require the actual session's `XDG_RUNTIME_DIR` (absolute) and `WAYLAND_DISPLAY` (a socket basename or absolute socket path). The helper checks the named Unix socket and executable presence each time. It never guesses a display or consumes `WAYLAND_SOCKET`/inherited descriptor access. Do not fabricate environment values to suggest compatibility. A socket can be stale, inaccessible or belong to a different desktop.

Probe performs no clipboard process, read or mutation. Its one-line JSON reports `availability: "candidate"` and `backend: "wayland"`, or `availability: "unavailable"` with a safe reason such as `unsupported_platform`, `wayland_session_missing`, `wayland_socket_missing`, or `wayland_binaries_missing`. Both `clipboardAccess` and `viewedDesktop` stay `"unverified"`. Candidate means prerequisites exist, not that a compositor accepts operations or the user sees that clipboard. There is no saved pairing/availability state. Cloud replacement requires installing and probing the new image again; socket/session loss is checked anew.

## Literal input and output

The limit is 256 KiB of exact UTF-8 bytes. Empty text, BOM, Unicode, quotes, backticks, dollar signs, CR/LF and trailing newlines are preserved. Invalid UTF-8, oversize data, NUL/nontext C0 controls except tab/CR/LF, DEL and C1 controls fail before a write. This conservative binary policy may reject some unusual text; the preexisting Mac text contract remains unchanged. Inputs are never normalized, trimmed or silently truncated.

`write --sha256 ORIGINAL_DIGEST` reads literal stdin to EOF. An optional `--file DATA_FILE` instead reads one already-created regular data file, with no symlink, URL, wildcard, command or remote filesystem grant. Quote the chosen filename as a shell argument, or use a fixed argument vector through the task tools. Never put the payload in a shell command. The digest is required and must be the original 64 lowercase hexadecimal SHA-256, not a newly computed digest of model-transcribed text. Validation completes before any clipboard subprocess. File/input size and time are bounded; input has a two-second deadline. A selected file that changes during capture fails. No original Mac filesystem path is conveyed to the helper.

```sh
# DATA_FILE already contains exact verified bytes; use the actual original digest.
holocron-cloud write --sha256 ORIGINAL_DIGEST --file DATA_FILE

# Explicitly capture once; stdout is sensitive literal data, not a general log.
holocron-cloud read > cloud-read.json
```

`read` emits one JSON object to stdout with `backend: "wayland"`, exact `text`, UTF-8 `byteCount`, lowercase `sha256`, and `viewedDesktop: "unverified"`. The JSON line's framing newline is not part of `text`. Decode the JSON string and UTF-8 encode that string; do not hash the escaped JSON source or raw stdout. An initial text BOM remains inside `text`. Save the result privately through the task's data/file tools. Error JSON on stderr contains only a safe code, no clipboard contents, environment, paths or tokens. A failed operation exits nonzero. Explicit read never watches or writes a clipboard.

The helper invokes `wl-paste --no-newline --type text/plain;charset=utf-8`. If that exact text representation is absent, the compositor/session is inaccessible, the subprocess fails, or its output is binary/invalid/oversize, read fails. It does not substitute an image, attachment, primary selection or another MIME type. Subprocess reads have a two-second deadline and bounded stdout; stderr is discarded. Only `LANG=C.UTF-8`, `XDG_RUNTIME_DIR` and `WAYLAND_DISPLAY` reach clipboard subprocesses. Provider/tunnel secrets, debug/preload variables and private configuration are not forwarded or inspected.

## Clipboard ownership

Write runs `wl-copy --foreground --type text/plain;charset=utf-8` with literal bytes on stdin. It retains that foreground worker instead of killing it and claiming the clipboard persists. A bounded startup verification reads back the same MIME bytes until their original digest and size match, within two seconds. This verification is part of the explicitly requested write and can read the previous clipboard while publication starts; those verification bytes are never returned or logged. It is not an ongoing watcher.

After exact backend readback with the owner still running, stdout emits a JSON `state: "owned"` event with `byteCount`, `sha256`, `lifetime: "foreground-process"`, `maximumHoldMs: 1800000`, and `viewedDesktop: "unverified"`. Keep the helper in an authorized managed foreground task or terminal while the user pastes. The command stays running; a timeout that kills it ends ownership. The event proves only initial backend byte equality, not viewed-desktop identity, later clipboard contents or that a command ran.

Ownership lasts until the backend releases it, the compositor/session is lost, SIGINT/SIGTERM stops the helper, or the fixed 30-minute maximum expires. A replacement clipboard owner normally makes `wl-copy` exit zero; the helper then emits `state: "ownership-ended", reason: "backend_released"` and exits zero. Other endings report `backend_failed`, `cancelled` or `hold_expired` and exit nonzero. An early exit or failed initial verification never emits `owned`. Cleanup kills and waits for its worker; it never clears another application's clipboard. Stopping this owner can remove its offered bytes; a clipboard manager might retain a copy, but persistence is not promised. No automatic replay or stored success follows restart. SIGKILL of the helper cannot run cleanup and may orphan its foreground worker until replacement/session teardown; deliberately use SIGINT/SIGTERM or terminate the whole managed process group for cleanup.

The backend's [official manual](https://github.com/bugaevc/wl-clipboard/blob/master/data/wl-clipboard.1) documents default background ownership, `--foreground`, MIME type and newline options. Its [copy implementation](https://github.com/bugaevc/wl-clipboard/blob/master/src/wl-copy.c) exits on selection cancellation. Those docs establish standard process semantics, not support in this user's actual cloud desktop. No synthetic paste or Enter event is sent.

## Mac to cloud

Only after the user explicitly shares a Mac snapshot and requests cloud clipboard copying:

1. Use authenticated `list_shared_items` and `read_shared_item`. Save the exact structured page objects as data through the dot's existing tools, not by retyping their text. Follow the returned UTF-8 byte `nextOffset` until complete. A context file can also be used if it fits the clipboard limit.
2. Check one immutable ID/kind, matching `sha256`/`byteCount`, contiguous byte offsets, one final complete page, total bytes and full digest. UTF-8 encode and concatenate exact `text`, preserving BOM and every newline. See [Context file materialization](context-files.md) for the full page-verification example; the same chain applies to `kind: "text"` with the 256 KiB bound. Save only the verified bytes into a chosen cloud data file.
3. Manually invoke `holocron-cloud write --sha256` with the **original snapshot digest** and `--file` with that file. The helper independently validates bytes and digest before any mutation, then verifies backend readback and holds ownership. Preserve the owner process while pasting. On mismatch, reread/rematerialize rather than changing the expected digest.
4. The user takes over the intended viewed cloud desktop and pastes into a benign editor to validate exact bytes before choosing whether to execute anything. This live check remains deferred.

The chain is original immutable snapshot SHA-256 → exact structured pages → verified materialized bytes → required helper expected digest → exact backend readback. Model transcription cannot silently pass with the original digest. Returning content does not itself authorize writing a clipboard, executing the text, or treating it as an attachment.

## Cloud to Mac

Only after an explicit request to read the cloud clipboard and copy that capture to the Mac, run helper `read` and retain its exact JSON result as data. Before calling `copy_text_to_mac`, verify the UTF-8 `text` bytes match `byteCount` and the original helper `sha256`. Pass the exact decoded `text`, a fresh unique request ID, a fresh canonical millisecond UTC deadline within five minutes, and `expected_sha256` equal to the **original helper digest**. The Mac server checks the digest before receipts or mutation, including retries. Never regenerate the expected digest from altered text.

For an already-created exact `cloud-read.json`, the task's existing data tools can prepare a literal tool-argument file using Python:

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

Use that exact argument object through the installed plugin's tool surface. It is not a direct server URL, a shell command or a token-bearing HTTP request. If a tool surface cannot preserve exact data, stop and report that transfer is unavailable; transcription plus a new digest is not verification. The chain is captured backend bytes → helper JSON/digest → verified literal tool arguments with original expected digest → Mac pre-dispatch digest validation → durable receipt → user-controlled paste. Identical text/deadline retries return the original receipt, even if the matching optional digest is added/omitted; mismatch and unauthorized retries cannot write. Failed/uncertain writes require a deliberate new request, never automatic replay.

## Deferred installation evidence

Probe, backend readback, executable presence and injected local/package tests cannot establish clipboard access to the intended viewed desktop. After the actual target/provider/tunnel/plugin is available, explicitly test harmless literal markers in both directions in the same viewed session. Observe takeover paste/capture, Unicode/BOM/quotes/backticks/dollars/newlines, replacement ownership, session loss, cloud replacement/reinstallation and Mac editor paste without execution. Until then, account/provider/tunnel/Dots and both viewed clipboard acceptance cases remain unverified.
