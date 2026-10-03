# Private installation and operation

Implementation is locally checked. Actual intended Dots/provider/OAuth/tunnel/plugin and viewed Mac/cloud clipboard compatibility are **deferred and unverified**. Configure those systems later using [Connection setup](phase1-setup.md), then run the acceptance steps below. No real provider has been selected.

## Pack and install the Mac companion

Use exactly Node `24.21.0` and npm `11.19.0`; check both versions in the activated runtime. Install/activate that runtime through your existing Node manager. Keep its absolute Node path available for the optional login job. The private package is `@shared-clipboard/dots-probe` version `0.1.0`; the historical name and `shared-clipboard-probe` alias are retained. Public registry publication is outside scope.

In the source checkout, choose fresh dedicated directories outside it. `mkdir` intentionally refuses existing directories on first setup; do not repurpose an unrelated installation or private directory. For upgrades, reuse only your own recorded bridge directories.

```sh
umask 077
SC_INSTALL="$HOME/Library/Application Support/shared-clipboard-package"
SC_PRIVATE="$HOME/Library/Application Support/shared-clipboard-operator"
mkdir "$SC_INSTALL" "$SC_PRIVATE"
mise exec node@24.21.0 -- node --version
mise exec node@24.21.0 -- npm --version
mise exec node@24.21.0 -- npm ci
mise exec node@24.21.0 -- npm run check
mise exec node@24.21.0 -- npm pack --pack-destination "$SC_PRIVATE"
mise exec node@24.21.0 -- npm install --prefix "$SC_INSTALL" --omit=dev --ignore-scripts \
  "$SC_PRIVATE/shared-clipboard-dots-probe-0.1.0.tgz"
SC_NODE="$(mise where node@24.21.0)/bin/node"
SC_CLI="$SC_INSTALL/node_modules/@shared-clipboard/dots-probe/dist/cli.js"
SC_CONFIG="$SC_PRIVATE/operator.json"
"$SC_NODE" "$SC_CLI" --version
"$SC_NODE" "$SC_CLI" --help
```

If the parent `Library/Application Support` is missing, create it first. With another manager, use its actual absolute Node executable after confirming the exact version. The dedicated prefix avoids changing global npm/Codex settings. Three bins are installed in its `node_modules/.bin`: `shared-clipboard`, `shared-clipboard-probe` and `shared-clipboard-cloud`. The last is independently usable on Linux without Mac/operator credentials. Absolute Node/CLI invocation avoids an interactive shell PATH. The tarball contains built `dist`, docs, README and the unmapped plugin scaffold; it contains no tests, shared state or secrets.

Create `operator.json` in the private directory using the complete public-input example in [Connection setup](phase1-setup.md), replacing all placeholders with your actual provider/connection values. Keep mode `0600` and parent mode `0700`. It contains public issuer/JWKS/resource/owner/scopes, not tokens or client secrets. An optional `stateDirectory` must be canonical absolute and private, outside the checkout; the default is `~/Library/Application Support/shared-clipboard`. Schema validation makes no provider/clipboard/network calls.

```sh
"$SC_NODE" "$SC_CLI" check-config --config "$SC_CONFIG"
"$SC_NODE" "$SC_CLI" start --config "$SC_CONFIG"
```

`start` stays in the foreground. Keep that terminal open, or use an authorized managed service/task. In another terminal use the same recorded absolute paths:

```sh
"$SC_NODE" "$SC_CLI" status --config "$SC_CONFIG"
"$SC_NODE" "$SC_CLI" stop --config "$SC_CONFIG"
```

Status checks the owner-only local control socket and retained-share counts. `available` means the local service responded; tunnel/dot/live OS capabilities remain unverified. It never infers remote delivery from a PID or launch job. Start again after stop for a deliberate restart. Stop cancels in-flight work and leaves snapshots, durable receipts and the current clipboard intact. A reused/unknown runtime PID is conservatively treated as running; do not kill it or delete the database to bypass the lease.

## Optional startup at login

Nothing installs or enables login startup during npm install, build, check, status or tests. On macOS, opt in explicitly with the installed pinned runtime and validated private config:

```sh
"$SC_NODE" "$SC_CLI" login-install --config "$SC_CONFIG"
"$SC_NODE" "$SC_CLI" login-status --config "$SC_CONFIG"
```

This generates only `~/Library/LaunchAgents/org.shared-clipboard.companion.plist`, mode `0600`, using actual canonical absolute installed Node/CLI and config paths. XML-escaped arguments remain literal argv; no shell, payload, secret, PATH shim or tunnel credential appears. Existing safe user directories keep their permissions. Symlinks, hardlinks, shared-write ancestors, XML-invalid paths and conflicting/edited same-label files are refused. Repeating the same install is a no-op; no other job or setting is changed.

The job runs once when loaded at the next graphical login (`RunAtLoad`, `KeepAlive=false`). It does not start now, restart after stop/crash, install a tunnel, refresh credentials or reconnect a plugin. `login-status` reports only the managed file's next-login intent; launchd/current companion remain unverified/unchanged. These commands never invoke launchctl. Job stdout/stderr go to `/dev/null`; troubleshoot with foreground `check-config`/`start` and local status.

To load now, stop any foreground companion first. In your own terminal, use only the exact dedicated job:

```sh
SC_JOB="$HOME/Library/LaunchAgents/org.shared-clipboard.companion.plist"
SC_TARGET="gui/$(id -u)/org.shared-clipboard.companion"
launchctl print "$SC_TARGET"
# If absent, load only the generated file into your graphical login domain.
launchctl bootstrap "gui/$(id -u)" "$SC_JOB"
"$SC_NODE" "$SC_CLI" status --config "$SC_CONFIG"
```

Inspect an already-loaded target; never replace an unfamiliar same-label service. Bootstrap/print success is not companion or remote health. Outside a graphical login domain, bootstrap can fail; use foreground instead. Start a known stopped loaded job deliberately with `launchctl kickstart "$SC_TARGET"`, without `-k` (which kills processes). The tunnel has its own separate foreground managed-client lifecycle.

`login-remove --config "$SC_CONFIG"` disables future login starts by removing only the exact owned file. It works even after the old config/installed paths disappear, but does not stop a current service or unload a loaded job. For removal/upgrade, stop first, use `launchctl bootout "$SC_TARGET"` for the known job if loaded, then `login-remove`. Inspect unfamiliar bootout errors; never remove another job. A temporary stop leaves login installed for next login. Before moving Node/package/config paths, remove the old job and reinstall using new absolute paths. Edited/conflicting files require inspection; no force-overwrite option exists.

The installed macOS `launchctl(1)` and `launchd.plist(5)` manuals define domain targets, bootstrap/bootout/kickstart, ProgramArguments and RunAtLoad/KeepAlive. Tests use isolated fake homes and, on macOS, `plutil` syntax checks only. Actual login/load/wake behavior remains deferred.

## Recovery and disconnect

The Mac companion, official outbound `tunnel-client`, existing public OAuth provider, registered developer MCP connection, generated private plugin and credential-free Linux helper are separate components. [Connection setup](phase1-setup.md) covers permissions, fresh private tunnel profiles, exact callback/resource, trusted discovery origins, bearer/Host/Origin tests and plugin generation. A private tunnel is not public plugin publication. `prepare-plugin` checks ID syntax only; it cannot prove a registration exists or works in the intended dot. Keep genuine IDs outside the repository/distribution.

For an expired/revoked connection, stop transfers, check local status and the tunnel's doctor/readiness, then reconnect through that actual ChatGPT connection's OAuth flow with the configured owner/scopes. Do not put bearer tokens in chat or automatically retry old failed/uncertain writes. Refresh developer-connection tool metadata after server/tool changes, then test in a fresh intended-dot conversation. Generate a new private plugin if registration changes; enable it in the product surface available to the dot. A Codex-local package proves neither Dots availability nor authentication. Never rewrite `~/.gg/codex/config.toml`, other plugins/marketplaces or unrelated tunnel profiles as a setup side effect.

Sleep/shutdown/offline companion or stopped/expired tunnel fails calls. The bridge has no offline delivery queue. The tunnel's own queued work is not a bridge guarantee: deadlines and renewed owner authorization prevent old envelopes from dispatching later. A write already dispatched before sleep/interruption may have changed the clipboard; an uncertain receipt is never automatically replayed. Completed retries return the old receipt without overwriting newer contents. Deliberate retries after failure/uncertainty need a fresh ID/deadline and a new user decision. Snapshot reads deny expiry immediately; purge runs on startup/operations/minute timer, and cannot run while the process is stopped.

Disconnect the connection/disable the plugin in ChatGPT to stop its remote availability. Stop the Mac companion/tunnel for a local endpoint/transport cutoff. Local stop does not revoke issued provider JWTs or external tunnel keys. No introspection/revocation endpoint exists; valid JWTs can remain acceptable until expiry (at most one hour) while the server runs. Separately revoke the provider OAuth grant/client/access or refresh credentials and the tunnel runtime key/association in their owner controls. Never infer external revocation from local status. Use `fidelius` and its help for concrete credential requirements, never chat/source/logs. No credentials reach the Linux helper.

## Clear and remove

`revoke SHARE_ID` and `clear` remove the current owner's retained shares, leaving retry receipts/current clipboard alone. They cannot erase copies in dot context, task files, another application or clipboard manager. Owner-only local snapshots are **plaintext**, not encryption at rest. SQLite DELETE journals, FULL commits and secure deletion do not erase backups or guarantee forensic removal from SSD storage. Protect the OS account/backups. Receipt fingerprints/metadata persist seven days; deleting receipts alone is not normal cleanup.

Remove only your recorded bridge-owned resources, in this order:

1. Disable/disconnect the actual plugin/connection and revoke only its provider grant and tunnel key/association if desired. Gracefully stop your dedicated tunnel managed process. External controls remain independent of local removal.
2. Clear shares if desired, stop the companion, unload the known login job if loaded, then `login-remove`. Stop cloud helpers with SIGINT/SIGTERM or whole managed process-group termination; SIGKILL of only the helper may orphan its backend. Leave unrelated clipboard contents alone.
3. After all bridge/CLI processes using the state have exited, inspect ownership/type and delete only `bridge.sqlite`, any private `bridge.sqlite-journal`, `bridge.sqlite-wal`, `bridge.sqlite-shm`, or stale `control.sock` in the recorded state directory. Never follow symlinks, recurse over unknown contents or kill an unknown/reused PID. Remove the directory only if empty. Full removal discards shares and receipt history; expired envelopes still cannot write after reinstall.
4. Run `mise exec node@24.21.0 -- npm uninstall --prefix "$SC_INSTALL" --ignore-scripts @shared-clipboard/dots-probe`. Remove only your generated private plugin's `plugin.json`/`.app.json`, operator JSON, private tarball and dedicated tunnel profile/secret reference after confirming no other consumer uses them. Remove directories only when empty. Preserve original selected files, unrelated settings/plugins/jobs and current clipboards.
5. On cloud replacement, explicitly reinstall/probe the helper in the new intended session. It has no persistent pairing, credential or network state. Removing its package leaves task files until you explicitly remove those copies too.

## User-run live acceptance, still deferred

Record dated results privately without credentials/personal payloads. Local tests and Inspector cannot substitute:

1. In the actual intended dot/account/workspace, discover the installed registered plugin, call status/synthetic read as the owner, and prove nonowner/missing-scope/expired or disconnected rejection. Verify exact callback, sole resource audience, public provider discovery and tunnel bearer/Host/Origin/trusted-origin behavior.
2. Explicitly share a harmless literal Mac marker with Unicode, BOM, quotes, dollars, backticks and newlines. Retrieve it through that dot. Copy a response to the Mac and paste in a benign viewed editor without executing it. Repeat the identical request after copying newer text and prove no overwrite.
3. Share a harmless multipage file, summarize/reconstruct it through the dot's existing tools and independently compare bytes/SHA-256. Modify/delete the source, revoke/expire the snapshot and prove subsequent reads fail. Unselected paths/current clipboard remain unavailable.
4. Install/probe the helper in the actual viewed Wayland session. Transfer Mac-to-cloud with the original snapshot digest, hold the owner while taking over and pasting into a benign field. Copy another harmless marker in that same viewed desktop, explicitly capture it, pass its original digest to the Mac copy tool and observe Mac paste. Probe/readback/exit status do not prove viewed-session identity.
5. Exercise replacement, graceful helper stop, session/cloud replacement, companion stop/restart, disconnect/reconnect/credential expiry and real sleep/wake. Observe no delayed write queue, no replay of uncertain/expired requests, no execution/unrelated clipboard/config changes, and optional login start/disable on the real Mac.
