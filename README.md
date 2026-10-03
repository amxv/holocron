# Board

Board shares text and selected UTF-8 context files with ChatGPT and can copy requested literal text to your Mac clipboard. You paste it yourself and decide whether to run it. Shares are explicit immutable snapshots, with no clipboard watcher, automatic paste, command execution, remote live clipboard read or arbitrary filesystem access.

Start with the [Board setup guide](https://clipboard.ashray.xyz/docs/getting-started), or the offline `docs/getting-started.md` guide. The [one-command installer](docs/operations.md#one-command-cli-installation) uses existing authenticated GitHub CLI access to the private release, verifies GitHub-recorded SHA-256 and installs a convenient `board` executable. After publication/deployment: `curl -fsSL https://clipboard.ashray.xyz/install.sh | sh`. It requires Node 24.21.0 and reads no existing runtime config/state. Link an existing setup explicitly with `board link --local-config /absolute/private/local.json`, then `board copy` to share your copied text once. The complete [private Secure MCP Tunnel guide](docs/secure-mcp-tunnel.md) covers owner-only config, direct STDIO launch and your existing tunnel. No external OAuth provider is needed for that private transport.

`board copy` shares a snapshot; normal Paste on the connected computer requires a separate explicit, digest-verified [Wayland helper operation](docs/cloud-clipboard.md#mac-to-cloud) in that viewed session. A connection alone does not deliver an OS clipboard. Historical `shared-clipboard` commands and the independent cloud helper remain available.

Every authorized private STDIO tunnel/workspace caller acts as the same fixed local owner. Restrict tunnel access to people authorized to read your chosen snapshots and request clipboard writes. The separate [OAuth HTTP setup](docs/phase1-setup.md) retains configured owner/resource/scopes on every protected request. [Operations](docs/operations.md), [text and receipts](docs/text-bridge.md), [context files](docs/context-files.md) and the independent [Linux Wayland cloud helper](docs/cloud-clipboard.md) cover the other boundaries.

Text/clipboard limit: 256 KiB. Context file limit: 10 MiB. Aggregate snapshots: 100 MiB. Reads: at most 64 KiB of UTF-8 per page. Shares expire after 24 hours. Files are immutable captures with SHA-256, not ongoing path grants or native attachments. Unsupported, binary or oversize inputs fail without truncation.

The Mac must be awake and the companion/tunnel available. The bridge has no offline write queue. Completed request receipts prevent duplicate writes from replacing newer clipboard contents; interruption can leave an uncertain result that is never replayed automatically. Private local snapshots are plaintext. Revoke/clear cannot erase copies already returned to the dot or another application. Stop/disconnect leaves the current clipboard alone. [Recovery, removal and user-run live acceptance](docs/operations.md#recovery-and-disconnect) cover the remaining operational boundaries.

Actual ChatGPT/Dots discovery, real tunnel and viewed Mac/cloud clipboard outcomes remain **deferred and unverified** until tested in the intended installation. Local gates use isolated state and injected clipboard adapters, never an existing OS clipboard or tunnel credentials.

## Validate locally

```sh
mise exec node@24.21.0 -- npm ci
mise exec node@24.21.0 -- npm audit
mise exec node@24.21.0 -- npm run check
git diff --check
```

The gate includes typecheck/build, OAuth security checks, official SDK STDIO subprocess tests, cancellation/failure/receipt recovery, 10 MiB file reconstruction, concurrent sharing/read/revoke stress, and a clean tarball installation without development dependencies. The package is private; public npm publishing is not part of installation.

The documentation website lives in `site/` and consumes canonical root `docs/` files directly. Its dedicated Vercel project root is `site`, with `npm ci`, `npm run build` and output `dist`; enable outside-root source files so the build can read `../docs`. See `site/README.md` for exact website build/deploy settings when that directory is present.
