---
title: Mac companion
description: Install and operate the companion, or let Secure MCP Tunnel own the private STDIO runtime.
order: 4
category: Start
---

For the primary private tunnel path, follow [Secure MCP Tunnel](secure-mcp-tunnel.md): the tunnel client launches `stdio --local-config` and supervises that runtime. Explicit local sharing/status/stop use the same local config. The HTTP companion and optional HTTP login startup below use `--config` and remain OAuth protected; they are separate from the STDIO runtime.

Actual Dots/plugin discovery, tunnel and viewed Mac/cloud clipboard compatibility remain **deferred and unverified** until tested in the intended installation. Use [STDIO setup](secure-mcp-tunnel.md) for the private tunnel, or [OAuth HTTP setup](phase1-setup.md) for the separate provider-protected connection.

## One-command CLI installation

On macOS or Linux, activate **Node 24.21.0** using your existing Node manager. Install GitHub CLI (`gh`) and authenticate it yourself with read access to the **private** `amxv/holocron` repository. No public npm package or anonymous release download is available. The bootstrap is public-safe; the implementation bundle remains private. After the operator publishes `holocron-v0.2.0` and deploys this installer:

```sh
curl -fsSL https://holocron.ashray.xyz/install.sh | sh
```

Do not use sudo. The installer requires `node`, `gh`, `tar` and `mktemp`; it reports missing prerequisites or unavailable releases. It downloads the fixed-version `holocron-0.2.0.tgz` through your existing authenticated `gh`, checks its bytes against the SHA-256 and size recorded by GitHub's authenticated release API, rejects unsafe archive paths/types and installs its already-built production dependencies. It runs no npm installation scripts and collects no credentials. Missing digests, failed downloads or mismatched bytes fail before installation. This verifies authenticated GitHub origin and content integrity, not an independent publisher signature. A mutable release can still be changed by a repository maintainer; an already-installed version with different bytes is refused.

The default dedicated prefix is `~/.local/share/holocron-cli`; the executable is `~/.local/bin/holocron`. It pins the actual absolute Node executable. Keep that Node installation available. Add `~/.local/bin` to your shell PATH if necessary, or invoke the absolute executable from shortcuts. The installer does not edit shell files, config, tunnel profiles, plugin mappings, state, login jobs or clipboards; it starts/stops nothing. Existing custom installations are preserved, and an unrelated/edited `holocron` executable or nonempty unrecognized prefix is refused.

To inspect the public bootstrap first or select custom canonical absolute paths:

```sh
curl -fsSL https://holocron.ashray.xyz/install.sh -o /tmp/holocron-install.sh
sh /tmp/holocron-install.sh --help
sh /tmp/holocron-install.sh --version 0.2.0 \
  --prefix "$HOME/.local/share/holocron-cli" --bin-dir "$HOME/.local/bin"
rm /tmp/holocron-install.sh
```

Repeating an identical install is a no-op. To upgrade, explicitly select a newly published version with `--version X.Y.Z`. The executable switches after complete staging; previous release directories remain for running processes and pinned tunnel commands. No live runtime is restarted or reconfigured. Reconnect your own tunnel deliberately if you want its next subprocess to use the new CLI. Concurrent installations are refused; inspect a stale `.install-lock` only after verifying no installer is running. On failure, temporary downloads and owned staging files are removed. An interrupted installation may leave a lock or unreferenced release for inspection; there is no force-overwrite or automatic recursive cleanup of existing data.

The new source/installer pin is `holocron-v0.2.0`, asset `holocron-0.2.0.tgz`. Preserve the already-published `board-v0.1.0` and `holocron-v0.1.1` tags/releases/assets; never replace their bytes. The source pin does not establish publication or deployment. The [secure receiving-agent setup](secret-requests.md#receiving-agent-handoff) adds a separate relay and native approval; installation alone pairs nothing.

An optional `--attestation` additionally requires `gh release verify-asset` to validate a signed immutable-release attestation. It fails if no attestation is available. Normal installation works with the repository's existing mutable-release settings; changing repository settings is not required.

For an **existing private STDIO setup**, explicitly link its actual local config:

```sh
"$HOME/.local/bin/holocron" link --local-config /absolute/private/Holocron/local.json
"$HOME/.local/bin/holocron" copy --name "Copied text"
"$HOME/.local/bin/holocron" list
```

`link` validates only the owner-only local config and saves its absolute path in the selected profile's `cli.json`; it never opens state or starts a runtime. It does not adopt an OAuth HTTP config. `HOLOCRON_CLI_HOME` selects a custom canonical absolute private profile directory, with `BOARD_CLI_HOME` retained as a fallback. `--local-config` takes precedence over `HOLOCRON_LOCAL_CONFIG`, legacy `BOARD_LOCAL_CONFIG` and the saved link. Config permissions and fixed-owner separation remain enforced.

For a **new setup**, `holocron init` creates a new private `~/.config/holocron/local.json`, state reference and CLI link, refusing existing config/link files. State is created only by a later explicit state command. Use the absolute `holocron stdio` command in [tunnel setup](secure-mcp-tunnel.md); initialization alone connects nothing. The wrapper runs from its installed code directory, resolving selected relative file paths before changing directory. Normal `holocron` use works from your home, `/` or the state directory without weakening the private-state guard. Historical direct `shared-clipboard` commands keep their original working-directory requirement.

`holocron copy` shares an immutable text snapshot. It does **not** fill the connected computer's OS clipboard. Connected ChatGPT must read the share, preserve and verify exact bytes, then explicitly operate the [Wayland helper](cloud-clipboard.md) in that computer's intended graphical session while the user pastes. A standalone receiver has no credential-free tunnel pull API here. Ordinary Paste on another personal computer is not implemented by snapshot sharing.

## Migrate an existing Board setup

Install Holocron into its new default `~/.local/share/holocron-cli` prefix and `~/.local/bin/holocron`. The installer leaves `~/.local/share/board-cli`, its `.board-install.json`, the existing `~/.local/bin/board` launcher and all old release directories intact. Do not reuse the old Board prefix for the new installer. Published `board-v0.1.0` and `holocron-v0.1.1` assets remain immutable, available from the renamed private repository for existing installs.

Holocron selects an existing `~/.config/board` profile when no `~/.config/holocron` profile exists, reading the original link in place. It retains `BOARD_CLI_HOME` and `BOARD_LOCAL_CONFIG` as fallback environment names. `HOLOCRON_CLI_HOME` and `HOLOCRON_LOCAL_CONFIG` take precedence. No config, token or database is copied. If the live tunnel uses another config, explicitly run `holocron link --local-config /actual/existing/private/local.json`. Keep the original path, state directory and permissions; do not rename the config just because the product changed names. `init` is for fresh setups and refuses existing linked profiles.

Local STDIO owner IDs, share IDs, SQLite tables, receipt fingerprints and configured state paths are preserved. Existing HTTP default state and managed `org.shared-clipboard.companion` login jobs remain compatible in place. A new login job uses `org.holocron.companion`; when an old job file exists, commands validate/manage that exact legacy file instead, refusing conflicts or two labels. Read the returned `label` before using launchctl. Do not replace an old job with a new label while it is loaded.

Leave the live tunnel on its recorded old executable/config until a deliberate operator reconnect. At that time, update only its existing MCP command to `"/actual/home/.local/bin/holocron" stdio --local-config "/actual/existing/private/local.json"`, keeping its tunnel ID, association, key reference and native profile/runtime identity. Stop the known old runtime before reconnecting it; do not run a second companion against the same state. Verify native process/health/readiness and actual tool discovery separately. Existing private plugin mappings continue to work; generate a fresh Holocron mapping only when deliberately updating its installation, using the same registered connection ID.

## Raycast shortcuts in the monorepo

The maintained extension now lives in `raycast/` of private `amxv/holocron`. See the [extension installation guide](https://github.com/amxv/holocron/blob/main/raycast/README.md). Install/link the Holocron CLI first, then run `bun install --cwd raycast --frozen-lockfile`, `bun run --cwd raycast lint`, `bun run --cwd raycast build` and `bun run --cwd raycast dev` from the checkout. Import the `raycast/` folder, then stop development with Control-C after ready; imported commands remain installed. Local import does not publish to the private `zue-ai` store.

The renamed extension has a new Raycast identity. Before import, record the old Board preferences and hotkeys. Clear or disable the old **Share Clipboard with Board** binding before assigning **Share Clipboard with Holocron** the verified existing Control+Option+Command+C shortcut. Check both extensions for duplicate bindings, then disable/remove the old imported extension after the new commands work. Finder sharing had no recorded hotkey; assign one only if desired. Preferences/hotkeys do not automatically transfer across extension names. Blank executable preference uses the absolute home-derived `~/.local/bin/holocron`; preserve an existing custom absolute config path if needed. Neither import nor hotkey assignment should capture the current clipboard. Test later only with a deliberately copied harmless marker and one selected UTF-8 file.

## Pack and install the Mac companion

Use exactly Node `24.21.0` and Bun `1.4.0`; check both versions in the activated runtime. Install/activate that runtime through your existing Node manager. Keep its absolute Node path available for the optional login job. The private package is `@amxv/holocron` version `0.2.0`; legacy command aliases remain available for migration. Public registry publication is outside scope.

In the source checkout, choose fresh dedicated directories outside it. `mkdir` intentionally refuses existing directories on first setup; do not repurpose an unrelated installation or private directory. For upgrades, reuse only your own recorded bridge directories.

```sh
umask 077
SC_INSTALL="$HOME/Library/Application Support/holocron-package"
SC_PRIVATE="$HOME/Library/Application Support/holocron-operator"
mkdir "$SC_INSTALL" "$SC_PRIVATE"
mise exec node@24.21.0 -- node --version
mise exec node@24.21.0 -- bun --version
mise exec node@24.21.0 -- bun run ci:all
HOLOCRON_TEST_REDIS_SERVER=/absolute/test/redis-server mise exec node@24.21.0 -- bun run check
mise exec node@24.21.0 -- bun pm pack --ignore-scripts --filename "$SC_PRIVATE/amxv-holocron-0.2.0.tgz"
mise exec node@24.21.0 -- bun install --cwd "$SC_INSTALL" --production --ignore-scripts \
  "$SC_PRIVATE/amxv-holocron-0.2.0.tgz"
SC_NODE="$(mise where node@24.21.0)/bin/node"
SC_CLI="$SC_INSTALL/node_modules/@amxv/holocron/dist/cli.js"
SC_CONFIG="$SC_PRIVATE/operator.json"
"$SC_NODE" "$SC_CLI" --version
"$SC_NODE" "$SC_CLI" --help
```

If the parent `Library/Application Support` is missing, create it first. With another manager, use its actual absolute Node executable after confirming the exact version. The dedicated prefix avoids changing global Bun/Codex settings. Six bins are installed in its `node_modules/.bin`: `holocron`, `holocron-cloud`, `board`, `shared-clipboard`, `shared-clipboard-probe` and `shared-clipboard-cloud`. The last is independently usable on Linux without Mac/operator credentials. Absolute Node/CLI invocation avoids an interactive shell PATH. The tarball contains built `dist`, docs, README, native AppKit source and the unmapped plugin scaffold; it contains no tests, shared state or secrets.

Create `operator.json` in the private directory using the complete public-input example in [Connection setup](phase1-setup.md), replacing all placeholders with your actual provider/connection values. Keep mode `0600` and parent mode `0700`. It contains public issuer/JWKS/resource/owner/scopes, not tokens or client secrets. An optional `stateDirectory` must be canonical absolute and private, outside the checkout; new default state is `~/Library/Application Support/Holocron`; an existing `~/Library/Application Support/shared-clipboard` directory is reused in place. Schema validation makes no provider/clipboard/network calls.

Launch the companion or tunnel, and run local sharing/status/stop commands, from the installed package directory (for example, `cd "$SC_INSTALL"` when state is outside that prefix). State must also be outside the current working directory: launching from state or any ancestor of state is refused before opening it. Configure a supervisor's actual working directory accordingly. `check-config` alone does not exercise this guard. See [STDIO tunnel setup](secure-mcp-tunnel.md) for the private transport's exact commands.

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

## Publish the private CLI release and installer

These are operator-run publication steps, not installer side effects. Keep `amxv/holocron` private. Build from the final approved clean commit with Node `24.21.0` and Bun `1.4.0`:

```sh
bun run ci:all
HOLOCRON_TEST_REDIS_SERVER=/absolute/test/redis-server bun run check
bun install --cwd site --frozen-lockfile
bun run --cwd site check
bun audit --cwd site --audit-level=low
git diff --check
bun run release:bundle -- "$PWD/tmp/gg/release-0.2.0"
```

The root gate includes clean Bun tarball installation and a complete production-bundle/installer smoke with injected GitHub transport, isolated config/state and literal digest checks. `release:bundle` writes `holocron-0.2.0.tgz` and `SHA256SUMS` into the selected fresh output directory. It uses the committed dependency lockfile, production-only `bun install --frozen-lockfile --production --ignore-scripts` with copied dependency files, rejects symlinks/special files and includes no Node runtime or development dependencies. It runs installed help/version checks without touching any clipboard. Do not copy private configs, plugin mappings, tunnel profiles or state into the artifact. The separate pinned Node prerequisite is deliberate.

Before publication, prepare concise release notes at `tmp/gg/release-notes.md`, tag the exact approved commit and upload the bundle through authenticated GitHub CLI:

```sh
git tag -a holocron-v0.2.0 APPROVED_COMMIT_SHA -m "Holocron CLI 0.2.0"
git push origin holocron-v0.2.0
gh release create holocron-v0.2.0 \
  tmp/gg/release-0.2.0/holocron-0.2.0.tgz tmp/gg/release-0.2.0/SHA256SUMS \
  --repo amxv/holocron --verify-tag --title "Holocron CLI 0.2.0" \
  --notes-file tmp/gg/release-notes.md
gh api repos/amxv/holocron/releases/tags/holocron-v0.2.0 \
  --jq '.assets[] | {name,digest,size}'
```

Replace placeholders and choose a new version/tag/output directory for later releases; do not overwrite a published version. Verify the API digest matches `SHA256SUMS`, then exercise the installer against the actual published release in a fresh dedicated private prefix/bin. That proves private access and hosted asset readiness beyond the injected smoke. Existing mutable-release settings are supported. Signed release attestation verification is an optional stronger path only when an operator has deliberately enabled/published immutable releases; no Actions artifact-attestation plan is required for normal installation.

Deploy the static docs project from the same approved repository content with Root Directory `site`, outside-root source files enabled, Node `24.x`, install command `bunx bun@1.4.0 install --frozen-lockfile`, build command `bunx bun@1.4.0 run build` and output `dist`. The checkout's `site/README.md` carries the complete project settings. `site/public/install.sh` becomes `https://holocron.ashray.xyz/install.sh`; site validation checks identical served bytes, shell syntax and public-safe content. The Vercel project serves public docs, the bootstrap and the separate ciphertext-only secret API, never the private bundle/source. Secret API deployment additionally needs the [operator prerequisites](secret-requests.md#operator-prerequisites). After deployment, fetch `install.sh`, compare it with the maintained file, and run `--help`. Only describe the one-command URL as ready once the private release and deployed bootstrap both pass these checks. Publication, DNS, repository settings and the user's actual CLI installation remain explicit operator actions.

Sources checked October 4, 2026: [GitHub release downloads](https://cli.github.com/manual/gh_release_download), [release-asset API and digest](https://docs.github.com/en/rest/releases/assets), [release creation](https://cli.github.com/manual/gh_release_create), [optional signed asset verification](https://cli.github.com/manual/gh_release_verify-asset).

## Optional startup at login

Nothing installs or enables login startup during Bun installation, build, check, status or tests. On macOS, opt in explicitly with the installed pinned runtime and validated private config:

```sh
"$SC_NODE" "$SC_CLI" login-install --config "$SC_CONFIG"
"$SC_NODE" "$SC_CLI" login-status --config "$SC_CONFIG"
```

This generates only `~/Library/LaunchAgents/org.holocron.companion.plist`, mode `0600`, using actual canonical absolute installed Node/CLI and config paths. XML-escaped arguments remain literal argv; no shell, payload, secret, PATH shim or tunnel credential appears. Existing safe user directories keep their permissions. Symlinks, hardlinks, shared-write ancestors, XML-invalid paths and conflicting/edited same-label files are refused. Repeating the same install is a no-op; no other job or setting is changed.

The job runs once when loaded at the next graphical login (`RunAtLoad`, `KeepAlive=false`). It does not start now, restart after stop/crash, install a tunnel, refresh credentials or reconnect a plugin. `login-status` reports only the managed file's next-login intent; launchd/current companion remain unverified/unchanged. These commands never invoke launchctl. Job stdout/stderr go to `/dev/null`; troubleshoot with foreground `check-config`/`start` and local status.

To load now, stop any foreground companion first. In your own terminal, use only the exact dedicated job:

```sh
SC_JOB="$HOME/Library/LaunchAgents/org.holocron.companion.plist"
SC_TARGET="gui/$(id -u)/org.holocron.companion"
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

For an installer-managed CLI, first disconnect/stop its explicitly managed runtime through your recorded tunnel controls if removing the code it uses. Inspect `~/.local/share/holocron-cli/.holocron-install.json` to identify its exact managed executable and retained release directories. Remove only the unchanged managed `holocron` wrapper and those dedicated code releases after all users of their paths have exited. Do not automatically delete `~/.config/holocron`, linked external local configs, private state/receipts, original selected files or a custom installation. Remove an unused `cli.json` link explicitly if desired. Old releases are deliberately retained through upgrades so installing a CLI never breaks a running subprocess. The installer has no destructive uninstall/force flag. The source/Bun-prefix route's removal steps below remain separate.

`revoke SHARE_ID` and `clear` remove the current owner's retained shares, leaving retry receipts/current clipboard alone. They cannot erase copies in dot context, task files, another application or clipboard manager. Owner-only local snapshots are **plaintext**, not encryption at rest. SQLite DELETE journals, FULL commits and secure deletion do not erase backups or guarantee forensic removal from SSD storage. Protect the OS account/backups. Receipt fingerprints/metadata persist seven days; deleting receipts alone is not normal cleanup.

Remove only your recorded bridge-owned resources, in this order:

1. Disable/disconnect the actual plugin/connection and revoke only its provider grant and tunnel key/association if desired. Gracefully stop your dedicated tunnel managed process. External controls remain independent of local removal.
2. Clear shares if desired, stop the companion, unload the known login job if loaded, then `login-remove`. Stop cloud helpers with SIGINT/SIGTERM or whole managed process-group termination; SIGKILL of only the helper may orphan its backend. Leave unrelated clipboard contents alone.
3. After all bridge/CLI processes using the state have exited, inspect ownership/type and delete only `bridge.sqlite`, any private `bridge.sqlite-journal`, `bridge.sqlite-wal`, `bridge.sqlite-shm`, or stale `control.sock` in the recorded state directory. Never follow symlinks, recurse over unknown contents or kill an unknown/reused PID. Remove the directory only if empty. Full removal discards shares and receipt history; expired envelopes still cannot write after reinstall.
4. Run `mise exec node@24.21.0 -- bun remove --cwd "$SC_INSTALL" --ignore-scripts @amxv/holocron`. Remove only your generated private plugin's `plugin.json`/`.app.json`, operator JSON, private tarball and dedicated tunnel profile/secret reference after confirming no other consumer uses them. Remove directories only when empty. Preserve original selected files, unrelated settings/plugins/jobs and current clipboards.
5. On cloud replacement, explicitly reinstall/probe the helper in the new intended session. It has no persistent pairing, credential or network state. Removing its package leaves task files until you explicitly remove those copies too.

## User-run live acceptance, still deferred

Record dated results privately without credentials/personal payloads. Local tests and Inspector cannot substitute:

1. In the actual intended dot/account/workspace, discover the installed registered plugin, call status/synthetic read as the owner, and prove nonowner/missing-scope/expired or disconnected rejection. Verify exact callback, sole resource audience, public provider discovery and tunnel bearer/Host/Origin/trusted-origin behavior.
2. Explicitly share a harmless literal Mac marker with Unicode, BOM, quotes, dollars, backticks and newlines. Retrieve it through that dot. Copy a response to the Mac and paste in a benign viewed editor without executing it. Repeat the identical request after copying newer text and prove no overwrite.
3. Share a harmless multipage file, summarize/reconstruct it through the dot's existing tools and independently compare bytes/SHA-256. Modify/delete the source, revoke/expire the snapshot and prove subsequent reads fail. Unselected paths/current clipboard remain unavailable.
4. Install/probe the helper in the actual viewed Wayland session. Transfer Mac-to-cloud with the original snapshot digest, hold the owner while taking over and pasting into a benign field. Copy another harmless marker in that same viewed desktop, explicitly capture it, pass its original digest to the Mac copy tool and observe Mac paste. Probe/readback/exit status do not prove viewed-session identity.
5. Exercise replacement, graceful helper stop, session/cloud replacement, companion stop/restart, disconnect/reconnect/credential expiry and real sleep/wake. Observe no delayed write queue, no replay of uncertain/expired requests, no execution/unrelated clipboard/config changes, and optional login start/disable on the real Mac.
