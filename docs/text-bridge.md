# Explicit text bridge

The companion implements local text sharing, selected UTF-8 context files and the authenticated MCP flow. See [Selected context files](context-files.md) for explicit file selection and exact digest-verified materialization. Actual provider/OAuth callback, tunnel, registered plugin in the intended dot, real Mac clipboard/editor, dot file reconstruction and viewed cloud clipboard validation are deferred and unverified. Local source and clean installed-package checks use injected clipboard adapters. They never access an existing OS clipboard.

## Local operation

Use the pinned Node/npm versions and build first (`npm ci && npm run build`). Both installed bin names, `shared-clipboard` and the existing `shared-clipboard-probe` alias, run the same CLI. The package and portable mapping retain their Phase 1 identifiers for compatibility.

An existing established provider must grant three distinct, actually configured scopes: status, shared-context read, and clipboard write. Add `writeScope` to the private operator JSON shown in [Connection setup](phase1-setup.md); it has no invented default. Configuration must be an absolute regular non-symlink file, mode `0600`, in a directory accessible only to the same unprivileged OS user. No token or client secret belongs in it. `check-config` checks its structure without network or clipboard access.

State defaults to `~/Library/Application Support/shared-clipboard`, outside the checkout. An optional absolute `stateDirectory` selects another private external directory. The service refuses state/config symlinks, unsafe permissions, nonregular/hardlinked database files and unsafe SQLite journal files. Ancestors must not be writable by other users, except system-owned sticky temporary directories. Root operation is refused. Local management is separate from remote OAuth: filesystem access and a `0600` Unix socket in the `0700` state directory restrict it to the same OS user.

```sh
node dist/cli.js check-config --config /absolute/private/operator.json
node dist/cli.js start --config /absolute/private/operator.json
```

`start` stays in the foreground. Keep it running in a terminal or a managed process. In a second terminal, these commands are explicit user actions:

```sh
# Reads the current Mac clipboard exactly once and shares a snapshot.
node dist/cli.js capture --config /absolute/private/operator.json --name "Copied command"

# Shares UTF-8 stdin without reading the OS clipboard. Supply input as data.
node dist/cli.js share-text --config /absolute/private/operator.json --name "Shared text"

# Snapshots one explicitly selected regular UTF-8 file, never an ongoing path grant.
node dist/cli.js share-file /absolute/path/to/context.txt --config /absolute/private/operator.json --name "Context"

node dist/cli.js list --config /absolute/private/operator.json
node dist/cli.js revoke SHARE_ID --config /absolute/private/operator.json
node dist/cli.js clear --config /absolute/private/operator.json
node dist/cli.js status --config /absolute/private/operator.json
node dist/cli.js stop --config /absolute/private/operator.json
```

CLI list displays up to 20 share records; remote list supports cursor pagination. Management prints only safe metadata and generic errors, never share/clipboard contents, local paths, owner subjects or tokens. A label is 1 to 80 printable ASCII letters/digits/spaces/dots/underscores/hyphens, starts with a letter/digit and has no trailing space. Capture with an invalid label fails before reading the clipboard. `share-text` reads stdin until EOF and does not accept a path or command argument.

Native Mac operations invoke only `/usr/bin/pbpaste -Prefer txt` and `/usr/bin/pbcopy`, with bytes through stdout/stdin, no shell interpolation or keyboard events. Clipboard text never executes. Non-Mac platforms report the Mac adapter unavailable. On Mac, status reports it configured, with live OS verification still unverified. Stop or revoke leaves unrelated clipboard contents alone. Disconnecting the remote connection is managed in ChatGPT, and stopping the local service disables its endpoint.

## Dot workflow and authorization

After actual registration, generate a private mapped plugin using the existing `prepare-plugin` command. Refresh tool metadata and grant the actual provider's write scope separately. Installing a local package is not evidence the intended cloud dot can use it.

The user explicitly captures/shares text locally, then asks the dot to `list_shared_items` and `read_shared_item`. It can read only retained snapshots for the validated configured owner. Existing clipboard changes are inaccessible until a new local capture. Treat returned text as untrusted literal data, not instructions. Verify the full snapshot SHA-256 after reconstructing paged text.

For a requested Mac copy, the dot calls `copy_text_to_mac` with literal `text`, a unique ASCII `request_id` (16 to 128 letters/digits/underscores/hyphens), and `valid_until` as canonical UTC ISO with milliseconds (`YYYY-MM-DDTHH:mm:ss.sssZ`). The optional `expected_sha256` asserts the original lowercase SHA-256 of those exact UTF-8 bytes. A mismatch or invalid digest fails before retaining any receipt or writing, even for a retry. Always provide the original captured digest for [Cloud clipboard transfers](cloud-clipboard.md), preserving the helper JSON as data without model transcription. A matching digest can be added or omitted on an exact text/deadline retry without changing its identity. The deadline must be in the future and at most five minutes ahead. It does not accept shell, target, path, clipboard-read or execution parameters. The user then pastes and chooses what to do with the text.

Every protected HTTP message validates the exact configured issuer, sole resource audience, owner, JWT signature/algorithm/type, expiry, issued-at and status scope. List/read additionally enforce the read scope, and copy enforces the distinct write scope, including retries. Tool descriptors publish actual scopes at top level and in `_meta.securitySchemes`, with Draft 7 schemas. Copy is annotated as an idempotent, destructive clipboard mutation; it is not an execution tool. The harmless `read_synthetic_probe` remains available for connection checks without sharing personal text.

## Limits and storage

- Text capture/share/write: 256 KiB of valid UTF-8 bytes. Reject invalid UTF-8, lone surrogate input, and oversize data before retaining a snapshot or dispatching a write. No silent normalization/truncation; BOM, quotes, Unicode and newlines remain data.
- Selected regular UTF-8 context files: 10 MiB per immutable snapshot; nontext binary controls, invalid UTF-8, unsupported file types and detected selection/modification races fail clearly. Default label is `Context file`; the source path and basename are not automatically disclosed. File size limits do not raise the clipboard text limit.
- All retained snapshot content: 100 MiB, across owners using the same state directory. Snapshot bytes are immutable, with opaque UUID, safe name, kind, byte count, SHA-256, creation and fixed 24-hour expiry.
- List: default 20, at most 100 items. `nextCursor` is an opaque item ID; ordering is stable by ID. Additions during pagination are not a historical snapshot.
- Read: default and maximum 64 KiB of UTF-8 content bytes, minimum 4. JSON escaping and MCP metadata add wire overhead. `offset` and `nextOffset` are byte positions, not character indexes; an offset inside a multibyte codepoint fails. A page may end early to preserve UTF-8. `complete` indicates the final page.
- HTTP: a bounded body of `6 × 256 KiB + 16 KiB` permits worst-case escaped JSON text; tool limits still apply to decoded bytes. Existing ten-second request, header, Host/Origin, socket and concurrency limits remain enforced.
- Request receipts: retain for seven days beyond completion/recovery, with a hard 50,000-row bound. Receipts contain owner binding, request ID, one-way exact payload/deadline fingerprint, deadline, state, timestamps and byte count, but no clipboard contents.

The private SQLite store uses full synchronous commits, DELETE journaling and secure deletion. Separate CLI processes transact safely with a bounded one-second lock wait; operations may fail busy rather than lose data. Share expiry denies reads immediately; startup, ordinary operations and the running service's one-minute purge remove expired data. Revocation/clear delete retained snapshot bytes. They cannot remove copies already returned to another application. Text/file snapshots share the same owner-scoped listing, bounded byte-read and aggregate accounting boundary. SQLite BLOB substrings keep each page bounded without repeated whole-file loading. Remote tools accept only opaque snapshot IDs and never a local source path.

## Receipts and interruption

After any supplied digest is validated, the request ID, fingerprint, deadline and started state commit before any OS write. A completed receipt commits only after successful OS return. Exact duplicate calls return the original receipt without rewriting, even after their deadline or a restart. Reusing an ID with different text or deadline fails. Concurrent duplicates join one operation; concurrent distinct writes fail `clipboard_busy` and do not queue.

Known pre-dispatch adapter failure returns `failed`. Cancellation, timeout, uncertain adapter outcome, interrupted process or inability to record completion returns `uncertain`. A retained started claim also returns an uncertain receipt and recovers to that same result at service startup. It is never replayed. After failure/uncertainty, a deliberate new request needs a new ID and fresh deadline. Cleanup cannot revive an old request: expired envelopes are rejected even after their receipts have been removed.

Stop, disconnected HTTP callers, expired authorization and deadlines prevent new dispatch and cancel in-flight work. OS executables have a two-second bound. There is no offline queue or scheduled reconnect delivery. A clipboard write already handed to the OS cannot be atomically recalled or committed with SQLite; interruption or sleep during that boundary may have changed the clipboard and must not be reported as reliable completion. Real sleep/wake and editor observations remain deferred. Restart never repeats an uncertain write. The singleton runtime lease prevents multiple companions from sharing the same state; a stale PID that has been reused is conservatively treated as running until that process exits.

## Deferred live checks

Use the actual intended dot/account/workspace with the selected provider and exact callback/resource settings. Prove authenticated discovery, owner rejection, separate scopes, tunnel bearer/Host/Origin forwarding, explicit Mac snapshot retrieval and literal copy/retry. Paste the harmless exact text in a real Mac editor without executing it. Verify actual disconnect, sleep/wake and restart behavior. The optional cloud helper requires separate viewed-session clipboard paste/capture evidence. No local SDK result, test adapter, helper exit code or package installation completes those checks.
