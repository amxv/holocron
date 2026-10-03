# Board documentation site

A static Astro site using the published `zuedocs@0.1.26` package. Its native header, footer, documentation article, sidebar, table of contents, code/page copy controls, theme controls, production Pagefind search and sitemap integration provide the shared documentation UI. The local document layout adds canonical/social metadata, self-hosted fonts, a skip link and Board branding.

## Develop and validate

From the repository root, with Node 24 and npm 11.19.0:

```sh
npm --prefix site ci
npm --prefix site run dev
```

Final checks:

```sh
npm --prefix site run validate
npm run check
git diff --check
```

`validate` runs Astro diagnostics, a production build, then verifies internal links/assets/anchors, metadata, sitemap, search coverage, identical raw Markdown, package/tool/limit references and public-content scans. Root checks also validate the canonical docs shipped in the private companion package. Preview the production build, including search, with:

```sh
npm --prefix site run preview -- --host 127.0.0.1 --port 4321
```

## Content ownership

- **`../docs/*.md` is the sole source for maintained guides.** Astro's collection loader reads it directly. Frontmatter defines title, description, ordering and category. These same files remain in the CLI tarball.
- Keep relative `guide.md#heading` links in canonical Markdown so repository/package readers can navigate. `scripts/docs-links.mjs` maps these to website routes during rendering.
- `src/pages/docs/[...slug].md.ts` publishes the original bytes at `/docs/<slug>.md`; native page-copy and Markdown actions use those routes.
- `src/data/docs.ts` owns Board metadata, navigation and categories. The homepage holds the short product introduction; it links to canonical setup rather than duplicating installation steps.
- Add new guides to the explicit package smoke allowlist in `../scripts/package-smoke.mjs` and update the expected guide count in `scripts/validate-site.mjs`. Keep all content public-safe. No runtime directory is loaded by the build.

The site does not need environment variables, tokens, OAuth configuration, plugin mapping IDs or a server runtime. Do not copy private config/state or generated mappings into this project. Self-hosted DM Sans and Instrument Serif font notices are preserved at `public/font-notices.txt`.

## Dedicated Vercel project

Use the repository as the source of a separate documentation project:

| Setting | Value |
| --- | --- |
| Root Directory | `site` |
| Include source files outside Root Directory in Build Step | Enabled, because canonical guides are in `../docs` |
| Framework Preset | Astro |
| Node.js Version | 24.x |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Environment variables | None |
| Production domain | `clipboard.ashray.xyz` |

`vercel.json` provides the framework/build/output configuration and basic response headers. Astro is explicitly static; no adapter is needed. `astro.config.mjs` uses the production domain for sitemap generation. The local document head uses it for canonical and social URLs. `public/robots.txt` points to the generated sitemap.

Build from the full repository checkout. Keep Vercel Git access and custom-domain/DNS setup with the operator; this implementation creates no deployments, project links, accounts or DNS changes. A Vercel deployment serves documentation only. The companion and official tunnel stay on the Mac, and the optional credential-free helper stays in the intended Linux Wayland session.
