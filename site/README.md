# Holocron documentation site

A static Astro site using the published `zuedocs@0.1.26` package. Its native header, footer, documentation article, sidebar, table of contents, code/page copy controls, theme controls, production Pagefind search and sitemap integration provide the shared documentation UI. The local document layout adds canonical/social metadata, self-hosted fonts, a skip link and Holocron branding.

## Develop and validate

From the repository root, with Node 24 and Bun 1.4.0:

```sh
bun install --cwd site --frozen-lockfile
bun run --cwd site dev
```

Final checks:

```sh
bun run --cwd site check
bun audit --cwd site --audit-level=low
HOLOCRON_TEST_REDIS_SERVER=/absolute/test/redis-server bun run check
git diff --check
```

The required site gate runs only `astro check`. Root checks also validate the canonical docs shipped in the private companion package. `bun run --cwd site build` is separate for deployment. Optional `bun run --cwd site validate` builds and checks production links/assets/anchors, metadata, sitemap, search coverage, identical raw Markdown and public-content scans. Preview an existing production build, including search, with:

```sh
bun run --cwd site preview -- --host 127.0.0.1 --port 4321
```

## Content ownership

- **`../docs/*.md` is the sole source for maintained guides.** Astro's collection loader reads it directly. Frontmatter defines title, description, ordering and category. These same files remain in the CLI tarball.
- Keep relative `guide.md#heading` links in canonical Markdown so repository/package readers can navigate. `scripts/docs-links.mjs` maps these to website routes during rendering.
- `src/pages/docs/[...slug].md.ts` publishes the original bytes at `/docs/<slug>.md`; native page-copy and Markdown actions use those routes.
- `src/data/docs.ts` owns Holocron metadata, navigation and categories. The homepage holds the short product introduction; it links to canonical setup rather than duplicating installation steps.
- Add new guides to the explicit package smoke allowlist in `../scripts/package-smoke.mjs` and update the expected guide count in `scripts/validate-site.mjs`. Keep all content public-safe. No runtime directory is loaded by the build.

Static documentation needs no environment variables, tokens, OAuth configuration or plugin mapping IDs. The separate Node secret API needs the three private variables in [operator prerequisites](../docs/secret-requests.md#operator-prerequisites); no real values/config/state belong in source or public assets. Root CLI checks typecheck that API; the local site gate stays Astro diagnostics only. Self-hosted DM Sans and Instrument Serif font notices are preserved at `public/font-notices.txt`.

## Dedicated Vercel project

Use the repository as the source of a separate documentation project:

| Setting | Value |
| --- | --- |
| Root Directory | `site` |
| Include source files outside Root Directory in Build Step | Enabled, because canonical guides are in `../docs` |
| Framework Preset | Astro |
| Node.js Version | 24.x |
| Install Command | `bun install --frozen-lockfile` |
| Build Command | `bun run build` |
| Output Directory | `dist` |
| Environment variables | None for static docs; three private secret-relay variables for `/api/secrets` |
| Production domain | `holocron.ashray.xyz` |

`vercel.json` provides the framework/build/output configuration and basic response headers. Astro is explicitly static; no adapter is needed. `astro.config.mjs` uses the production domain for sitemap generation. The local document head uses it for canonical and social URLs. `public/robots.txt` points to the generated sitemap.

Build from the full repository checkout. Keep Vercel Git access, resource setup and custom-domain/DNS with the operator; this implementation creates no deployments, project links, accounts or DNS changes. The project serves static documentation and a separate `/api/secrets` ciphertext-only function. The companion, native prompt sidecar and official tunnel stay on the Mac; the optional credential-free clipboard helper stays in its intended Linux Wayland session. The secret relay holds public metadata/token hashes/ciphertext, never entered key plaintext or endpoint private keys. Existing clipboard/MCP/tunnel routes stay independent.

The public bootstrap at `public/install.sh` is copied unchanged to `/install.sh` by Astro; validation checks bytes and shell syntax. It requires Node 24.21.0 and existing authenticated `gh` read access to the private repository. It fetches the fixed `holocron-v0.2.0` release, checks GitHub's authenticated asset SHA-256/size, then installs the private production bundle locally. The default path needs no repository setting changes; signed immutable-release attestations are optional with `--attestation`. Never place the bundle, Node modules, repository archive, runtime config or credentials under `public/`.

Publish the private release first using `docs/operations.md#publish-the-private-cli-release-and-installer`, then deploy this static site from the same approved content. Operator acceptance is a real authenticated install in an isolated prefix/bin plus fetched `/install.sh` byte comparison and `--help`. Until both succeed, the documented command remains pending publication/deployment. The companion's live runtime is not reconfigured or restarted by site deployment or CLI installation.

The secret API uses dedicated `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` and `HOLOCRON_SECRETS_ADMIN_TOKEN` server environment variables. Redis SDK retries, telemetry, latency logging and automatic pipelining are disabled; Redis calls have a five-second deadline and the Vercel function has a 15-second cap. No headers, request bodies or exceptions are logged. Keep bearer headers redacted and external payload capture disabled. Upstash provisioning stopped before human terms acceptance, so no live database/env values exist yet. The [canonical secret guide](../docs/secret-requests.md) owns operator setup, public descriptor pairing, the receiving-agent handoff and harmless acceptance.

The unsuppressed site audit baseline remains `http-cache-semantics` / Astro advisory GHSA-ch52-4w7c-c8xp. Static docs and this uncached Redis API introduce no authenticated shared HTTP cache or remote image reuse path; the existing reachability assessment remains applicable. Keep the audit command in the predeployment gate.
