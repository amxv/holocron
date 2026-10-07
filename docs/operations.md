---
title: Installation & maintenance
description: Installer details, upgrades, legacy migration, release operations and scoped removal.
order: 9
category: Reference
---

For daily setup, use [getting started](getting-started.md). The private context companion uses [Secure MCP Tunnel](secure-mcp-tunnel.md); key delivery uses the separate [Mac secret service](secret-operations.md). This reference covers maintained installations and operator work.

## One-command CLI installation

For automated prerequisites and saved setup, use [Mac setup](secret-operations.md#mac-setup) or the [one receiver command](secret-requests.md#install-and-pair-with-one-command). The CLI-only installer below requires Node **24.21.0**, `curl`, `tar` and `mktemp`, as an unprivileged user. It downloads public `amxv/holocron` release metadata and assets anonymously. GitHub CLI (`gh`) is needed only for optional `--attestation` verification or maintainer release operations; there is intentionally no public npm package.

```sh
set -eu
hc_bootstrap=$(mktemp)
curl -fsSL https://holocron.ashray.xyz/install.sh -o "$hc_bootstrap"
sh "$hc_bootstrap" --help
sh "$hc_bootstrap" --version 0.3.3 \
  --prefix "$HOME/.local/share/holocron-cli" --bin-dir "$HOME/.local/bin"
rm "$hc_bootstrap"
```

The bootstrap downloads the public production bundle and release metadata over HTTPS. It checks GitHub-recorded SHA-256/size, rejects unsafe archive paths/types and installs already-built production dependencies without npm lifecycle scripts. This establishes published GitHub release identity/content integrity, not an independent publisher signature.

Defaults are `~/.local/share/holocron-cli` and `~/.local/bin/holocron`. The executable pins your absolute Node path; keep it available. Custom paths must be canonical absolute paths. The installer starts nothing and does not edit your shell, config, state, tunnel, login jobs or clipboard.

An optional `--attestation` requires GitHub CLI plus any authentication it needs for `gh release verify-asset`, and fails closed if unavailable. Normal installation does not require a GitHub account. An unrelated/edited executable or unrecognized nonempty prefix is refused.

## Upgrades and install recovery

Repeating identical bytes/version is a no-op. To upgrade, deliberately select a **newly published** version with `--version X.Y.Z`. Previous release directories stay available for running processes. A different bundle for an installed version is refused. Never replace `board-v0.1.0`, `holocron-v0.1.1`, `holocron-v0.2.0`, `holocron-v0.3.0`, `holocron-v0.3.1`, `holocron-v0.3.2` or any published release; publish 0.3.3 separately. Existing Mac setups must also [refresh their native helper and restart](secret-operations.md#upgrade-a-saved-mac-setup).

Reconnect the known tunnel deliberately when you want its next subprocess to use the new CLI. Installation alone never restarts a runtime. Concurrent installs are refused; inspect a stale `.install-lock` only after confirming no installer is running. An interrupted install can leave a lock or unreferenced release. Inspect only the dedicated prefix; there is no force-overwrite or destructive uninstall flag.

## Migrate an existing Board setup

Use Holocron's new default install prefix; leave the Board prefix, launcher and retained releases in place. When no Holocron profile exists, the CLI uses an existing `~/.config/board` profile in place, without copying credentials or state.

`HOLOCRON_CLI_HOME` and `HOLOCRON_LOCAL_CONFIG` take precedence over the retained `BOARD_CLI_HOME` and `BOARD_LOCAL_CONFIG` fallbacks. To select your existing local config explicitly:

```sh
holocron link --local-config /absolute/private/existing-local.json
holocron status
```

Keep its actual path, state and permissions. `init` is for a fresh setup, not migration. Existing IDs, receipts, SQLite state and private plugin mappings remain compatible. At a deliberate reconnect, update only the known tunnel's MCP command to the absolute Holocron executable and same config, stopping its old runtime first. Never run two companions against one state directory.

For [Raycast](raycast.md), record old preferences and clear its old hotkey before assigning the new command. Choose your own shortcut; no binding is migrated automatically.

## Pack and install the Mac companion

The public release installer is the normal route. For an explicitly provided source tarball, use Node **24.21.0** and Bun **1.4.0**. From a validated source checkout:

```sh
umask 077
SC_INSTALL="$HOME/Library/Application Support/holocron-package"
SC_PRIVATE="$HOME/Library/Application Support/holocron-operator"
mkdir "$SC_INSTALL" "$SC_PRIVATE"
bun run ci:all
HOLOCRON_TEST_REDIS_SERVER=/absolute/test/redis-server bun run check
bun pm pack --ignore-scripts --filename "$SC_PRIVATE/amxv-holocron-0.3.3.tgz"
bun install --cwd "$SC_INSTALL" --production --ignore-scripts \
  "$SC_PRIVATE/amxv-holocron-0.3.3.tgz"
```

Create the parent first if missing, and use fresh dedicated directories. Record the actual absolute Node and installed CLI paths. The artifact includes `dist`, canonical docs, native prompt source and the unmapped plugin scaffold, not tests, website/Raycast source, runtime state or credentials. The `@amxv/holocron` manifest stays `private: true` to prevent accidental npm publication; its GitHub release artifact is public. [Legacy bins](reference.md) remain supported.

For direct `dist/cli.js`/historical CLI commands, launch from the installed package directory with state outside that directory and its ancestors. The friendly `holocron` wrapper anchors automatically. `check-config` alone does not exercise the state/working-directory guard. Use [STDIO setup](secure-mcp-tunnel.md) or the separate [HTTP configuration](phase1-setup.md) for their exact runtime contract.

## Publish the CLI release and installer

For future versions, keep every published tag/asset immutable. Build from a clean release commit with pinned Node/Bun after updating the version consistently:

```sh
bun run ci:all
HOLOCRON_TEST_REDIS_SERVER=/absolute/test/redis-server bun run check
bun audit
bun audit --cwd site --audit-level=low
git diff --check
bun run release:bundle -- "$PWD/tmp/gg/release-X.Y.Z"
```

Choose a new output directory and actual new version. `release:bundle` produces the versioned production archive and `SHA256SUMS`, using frozen production dependencies and installed help/version checks. Prepare concise notes, tag the exact approved SHA and upload with authenticated GitHub CLI:

```sh
git tag -a holocron-vX.Y.Z APPROVED_COMMIT_SHA -m "Holocron CLI X.Y.Z"
git push origin holocron-vX.Y.Z
gh release create holocron-vX.Y.Z \
  tmp/gg/release-X.Y.Z/holocron-X.Y.Z.tgz tmp/gg/release-X.Y.Z/SHA256SUMS \
  --repo amxv/holocron --verify-tag --title "Holocron CLI X.Y.Z" \
  --notes-file tmp/gg/release-notes.md
```

Verify GitHub's asset digest against `SHA256SUMS`, then exercise anonymous installation in a fresh isolated prefix/bin. Website deployment uses `site` as root, outside-root source inclusion, Node 24.x, Bun 1.4.0 and output `dist`; `site/README.md` carries the complete settings. The required local site gate is **Astro check only**; the production build runs during deployment. Keep the known unsuppressed site audit baseline GHSA-ch52-4w7c-c8xp separate.

The site publishes docs and the public-safe installer, plus the separate ciphertext-only `/api/secrets` function. The static site does not duplicate the CLI bundle or repository source into its public assets; release artifacts stay on GitHub. [Relay operator reference](secret-operations.md#relay-operator-reference) covers private variables. Compare fetched installer bytes to source and run its `--help` after deployment. Accounts, release publication and deployment remain explicit operator actions.

## Optional startup at login

This applies only to the **HTTP** companion, not the STDIO tunnel or secret service. Using recorded installed Node/CLI/config paths:

```sh
"$SC_NODE" "$SC_CLI" login-install --config "$SC_CONFIG"
"$SC_NODE" "$SC_CLI" login-status --config "$SC_CONFIG"
```

The owned `org.holocron.companion` LaunchAgent uses `RunAtLoad`, `KeepAlive=false`, and starts at the next graphical login. Installation does not load it now; `login-status` reports file intent, not running health. An existing managed legacy `org.shared-clipboard.companion` job is preserved and validated in place; use the actual returned label, never load both.

To load now, stop the known foreground HTTP companion first, inspect its exact dedicated target and use `launchctl bootstrap` in your graphical login domain. `launchctl print`/bootstrap success is not remote tool readiness. `login-remove` removes only the owned file and does not unload a current job. Stop and `launchctl bootout` only the known target before removing/upgrading it. Preserve unrelated jobs and inspect edited/conflicting files.

## Recovery and disconnect

Context companion, tunnel, plugin, OAuth provider, secret service and clipboard helper have independent lifecycles. Keep the Mac awake; restart only the known runtime. Check local `holocron status`, then the tunnel's own doctor/readiness, then actual tool discovery. Refresh tools and use a fresh agent conversation when connection metadata changes.

Stopping a service disables its local endpoint but does not revoke external tunnel/provider credentials. For HTTP, issued JWTs can remain valid until their bounded expiry (at most one hour) while the server runs. Use the provider/tunnel's own controls for revocation. [Secret pairing revocation](secret-operations.md#revoke-a-receiver) requires a backend acknowledgement.

There is no offline clipboard delivery queue or automatic replay of uncertain writes. After `failed`/`uncertain`, inspect the clipboard before a deliberate fresh request. Completed retries return the old receipt without overwriting newer text. A reused/unknown PID is conservatively treated as running; do not kill it or delete state to bypass the lease.

## Clear and remove

`holocron revoke SHARE_ID` and `holocron clear` remove retained snapshots, leaving receipts and current clipboard alone. They cannot erase agent context, saved files or other apps' copies. Local snapshots are plaintext; protect the OS account and backups. SQLite cleanup is not forensic SSD erasure.

1. Disable the intended plugin/connection and stop its dedicated tunnel/companion. Revoke secret pairings and external grants separately if desired.
2. Gracefully stop clipboard helpers. Unload/remove only the known managed HTTP login job.
3. For an installer-managed CLI, inspect its dedicated `.holocron-install.json`. After processes using its paths exit, remove only its unchanged managed wrapper and owned code releases. Preserve private configs/state and custom installations unless explicitly removing them.
4. For a source-prefix install, run `bun remove --cwd "$SC_INSTALL" --ignore-scripts @amxv/holocron`. Remove only recorded bridge-owned files/directories, and only empty directories. Do not follow symlinks or recurse over unknown data.

Full state removal discards shares and receipt history. Keep original selected files, unrelated settings/plugins/jobs and other clipboard contents. Replacement cloud sessions need a new helper install/probe.

## User-run live acceptance

Use harmless text on your actual devices. Verify discovery in the intended account, exact snapshot retrieval, file reconstruction/SHA-256, requested Mac copy plus observed paste, revoke/expiry rejection and reconnect/sleep behavior. For remote Paste, observe both directions in the same intended Wayland desktop while ownership is held. Local status, probe and injected fixtures do not establish those outcomes. For keys, use the [receiver/native GUI checklist](secret-operations.md#acceptance-on-your-devices).
