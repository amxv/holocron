# Shared Clipboard for ChatGPT Dots

A personal Mac companion for explicitly shared text and selected UTF-8 context files, with an owner-authenticated MCP plugin that can copy literal text to the Mac clipboard. You paste it yourself and decide whether to run it. There is no clipboard watcher, automatic paste, command execution, remote live clipboard read or arbitrary filesystem access.

**Actual intended Dots, registered plugin, OAuth provider/callback/resource, private tunnel and viewed Mac/cloud clipboard compatibility are deferred and unverified.** Local security and installed-package checks use injected adapters. They establish implementation behavior, not those live outcomes. No real provider has been selected.

## Use it

1. Follow [Private installation and operation](docs/operations.md) to pack/install with Node `24.21.0` and npm `11.19.0`, configure the private companion, and start/status/stop it. Startup at login is a separate explicit opt-in.
2. Follow [Provider, tunnel and plugin connection](docs/phase1-setup.md) for your existing public OAuth provider, official outbound tunnel client, actual developer MCP connection and generated private plugin. These are separate installations; the distributable plugin mapping is empty. Setup preserves other plugins and `~/.gg/codex` settings.
3. [Share text](docs/text-bridge.md) with `capture` or literal stdin, or [select context files](docs/context-files.md) with `share-file`. Ask the dot to list/read the chosen snapshot. Copy requests write literal bytes only after authorization and optional original digest verification.
4. For both cloud desktop directions, explicitly install the independent, credential-free [Linux Wayland helper](docs/cloud-clipboard.md) in the intended graphical session. Preserve the original digest through exact structured data and retain its foreground clipboard owner while pasting. Its prerequisite probe reports candidate/unavailable; viewed-desktop access remains unverified.

Text/clipboard limit: 256 KiB. Context file limit: 10 MiB. Aggregate snapshots: 100 MiB. Reads: at most 64 KiB of UTF-8 per page. Shares expire after 24 hours. Files are immutable captures with SHA-256, not ongoing path grants or native attachments. Unsupported, binary or oversize inputs fail without truncation.

The Mac must be awake and the companion/tunnel available. The bridge has no offline write queue. Completed request receipts prevent duplicate writes from replacing newer clipboard contents; interruption can leave an uncertain result that is never replayed automatically. Private local snapshots are plaintext. Revoke/clear cannot erase copies already returned to the dot or another application. Stop/disconnect leaves the current clipboard alone. [Recovery, removal and user-run live acceptance](docs/operations.md#recovery-and-disconnect) cover the remaining operational boundaries.

## Validate locally

```sh
mise exec node@24.21.0 -- npm ci
mise exec node@24.21.0 -- npm run check
git diff --check
```

The gate includes typecheck/build, auth/security/expiry/idempotency/file/cloud process tests, a fresh private tarball installation without development dependencies, and distribution/source scans. Tests never access an existing OS clipboard or actual login configuration. The package is private; public publication, a hosted relay, paid accounts, custom OAuth servers, broad local-computer access and a docs site are outside this implementation.
