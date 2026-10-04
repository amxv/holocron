---
title: OAuth HTTP connection
description: Configure the separate OAuth-protected HTTP connection and provider.
order: 5
category: Start
---

This guide is the alternative OAuth-protected HTTP connection. For an existing private OpenAI Secure MCP Tunnel, use [direct STDIO setup](secure-mcp-tunnel.md) with `--local-config`; no external OAuth provider is required for that transport. HTTP keeps its owner/resource/scope checks and accepts only `--config`.

Actual provider/OAuth, intended Dots/plugin discovery, tunnel forwarding and viewed clipboard compatibility remain **deferred and unverified** until checked in the real installation. Local tests establish implementation behavior only.

## Install and check

Start with [Private installation and operation](operations.md) for the clean local tarball install, absolute installed CLI paths, optional login startup, restart/recovery/removal and complete user-run acceptance. This document configures the external connection separately. Neither package install nor config validation creates a provider, tunnel, account or connection.

The runtime is pinned to Node `24.21.0` (LTS), Bun `1.4.0`, the official `@modelcontextprotocol/sdk` `1.32.0`, `jose` `6.2.12`, and Zod `4.6.5`. TypeScript is `7.0.2`. Versions were checked against current package manifests and [Node releases](https://nodejs.org/en/about/previous-releases). The lockfile pins transitive dependencies.

```sh
mise exec node@24.21.0 -- bun run ci:all
mise exec node@24.21.0 -- bun run check
```

Without mise, activate exactly the pinned runtime first. `check` performs typecheck, build, security/protocol/text/file/lifecycle tests, and a clean temporary package installation with authenticated/unauthorized text and bounded file reconstruction/digest smoke calls using injected clipboard adapters. No actual clipboard operations occur in checks. The package has an explicit distribution allowlist. Synthetic signing keys exist only in memory during tests; no test authorization server or production authentication bypass is shipped.

## Provider configuration boundary

Use an existing established provider/account. No paid account or custom authorization server is assumed. An operator-owned configuration file outside the checkout selects exact issuer, fixed HTTPS JWKS endpoint, owner subject, canonical HTTPS resource ending in `/mcp`, distinct scopes, asymmetric algorithm, and token header type. Secrets do not belong in this file. Preserve the provider issuer exactly, including any trailing slash.

Example of the required shape, using deliberately nonfunctional `.invalid` placeholders:

```json
{
  "issuer": "https://YOUR-PROVIDER.invalid",
  "jwksUrl": "https://YOUR-PROVIDER.invalid/jwks",
  "resource": "https://YOUR-RESOURCE.invalid/mcp",
  "ownerSubject": "REPLACE-WITH-EXACT-OWNER-SUBJECT",
  "tokenType": "at+jwt",
  "algorithm": "RS256",
  "statusScope": "probe:status",
  "readScope": "probe:read",
  "writeScope": "clipboard:write",
  "port": 4317,
  "allowedOrigins": []
}
```

All placeholders must be replaced before a live attempt. `check-config` validates structure only and makes no network calls. It does not verify a provider or connection. Use a private file with mode `0600` in an owner-only directory.

```sh
node dist/cli.js check-config --config /absolute/path/to/operator-config.json
node dist/cli.js start --config /absolute/path/to/operator-config.json
```

The provider must publish its own publicly reachable OAuth/OIDC discovery metadata, authorization and token endpoints, authorization-code with PKCE `S256`, and supported client registration (CIMD, DCR, or a predefined client supported by the actual connection surface). The resource server does not create, proxy, or fabricate authorization-server metadata. Confirm it issues access tokens with the exact resource as the **only audience**, `iss`, `sub`, integer `iat`/`exp`, a space-delimited `scope`, and lifetime at most one hour. Optional `nbf` is verified; optional `resource` must match too. Select its actual access-token `typ` (`at+jwt` or `JWT`) and algorithm (`RS256`, `ES256`, or `EdDSA`). A `JWT` provider must issue API access tokens with a distinct resource audience and required scopes; never use ID tokens or widen the audience to a client ID. Opaque tokens/introspection and other scope claim formats are outside this preparatory contract and require an explicit implementation decision if the chosen provider needs them.

Every protected HTTP message verifies signature, exact issuer, audience/resource, expiry/not-before/issued-at, owner, and the status scope. Read/list tools additionally require the read scope; copy requires its distinct write scope. All three names must differ and must exist in the selected provider. The sample names do not establish provider compatibility. Token-directed keys/URLs and symmetric/unsigned algorithms are rejected. JWKS retrieval uses only the configured HTTPS URL with a three-second timeout, bounded caching, and no redirect following. There is no token pass-through to another service.

GET `/.well-known/oauth-protected-resource/mcp` and the root discovery alias return the canonical resource, provider issuer, all three configured scopes, and header bearer transport. A rejected transport returns `WWW-Authenticate` referencing the path-specific discovery URL; tool-scope failures also return MCP `_meta["mcp/www_authenticate"]`. Tool descriptors publish OAuth scopes at the top level and in `_meta.securitySchemes`. SDK 1.32 does not accept top-level `securitySchemes` in `registerTool`, so the SDK `tools/list` handler is explicitly supplied while registered tool handlers retain schema enforcement.

Published tool JSON schemas use Draft 7, which matches the pinned SDK client's default validator. Zod 4 otherwise emits Draft 2020-12 tuple syntax that this client cannot validate. Both the wire metadata and the official SDK client's successful structured-result validation are checked locally.

The configured owner is represented in status results by an opaque SHA-256 principal ID plus `ownerMatched: true`, derived from validated issuer/subject. Raw subject, names, email, issuer claims, tokens, config paths, and personal data are not tool results. This establishes synthetic identity binding locally; actual provider identity binding remains a live gate.

## Private tunnel and registered plugin

Follow the current [Secure MCP Tunnel documentation](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) and [connection steps](https://developers.openai.com/plugins/deploy/connect-chatgpt):

1. Verify developer-mode eligibility in the intended ChatGPT account/workspace. Enable it in Settings, Security and login. Confirm the intended dot can use supported installed plugins in that execution environment.
2. Create or identify the real tunnel in Platform tunnel settings with Tunnels Read + Manage. Runtime/selection require Read + Use. Associate the tunnel with the owning Platform organization **and** the intended ChatGPT workspace. Organization membership alone does not establish workspace discovery.
3. Install the official full `tunnel-client` from the OpenAI Homebrew tap on macOS (`brew install openai/tools/tunnel-client`), or follow Platform settings/the latest official release for your platform. Use the supported current download and inspect its installed help. Start with `tunnel-client help quickstart`. The HTTP/OAuth starter is `sample_mcp_with_dcr`; its name does not select or verify a DCR provider. Use a fresh profile directory/name, without `--force`:

```sh
tunnel-client init --sample sample_mcp_with_dcr --profile holocron \
  --profile-dir /absolute/path/to/new-private-profile-directory \
  --tunnel-id ACTUAL_TUNNEL_ID --mcp-server-url http://127.0.0.1:4317/mcp \
  --control-plane-api-key-ref env:CONTROL_PLANE_API_KEY --health-listen-addr 127.0.0.1:0
```

Add only the actual canonical resource/metadata origin and external provider discovery origins to `mcp.oauth_trusted_origins` in this new profile before running `doctor --profile holocron --profile-dir /absolute/path/to/new-private-profile-directory --explain` and `run` with the same profile/directory. Current client discovery otherwise trusts only the configured loopback MCP origin. The runtime also exposes repeatable `--mcp.oauth-trusted-origin` flags for those exact origins. Keep unsafe raw HTTP logging, payload capture, remote admin UI, generic proxy/Harpoon targets, and static MCP Authorization overrides disabled. User bearer tokens must reach the probe intact; no shared static bearer token substitutes for owner OAuth. No unrelated profile or configuration is changed.
4. Keep the probe and tunnel client running. With GG, launch long-lived services using managed processes. The tunnel runtime key is only for the tunnel client; it is not a user bearer token for this MCP server.
5. Add the developer connection at ChatGPT Plugins, choose Tunnel, select the actual tunnel, and review discovered tools. Establish the canonical resource identifier used by this connection/provider and verify OAuth discovery through the tunnel. Do not invent an endpoint or assume the tunnel's forwarding of Host/Origin/token headers works before the live test.
6. Copy the **exact** OAuth redirect URI displayed on the connection's management page into the provider allowlist. Current docs describe stable redirects only for providers satisfying issuer identification; others use a callback-specific URI. Record the actual URI, registration mode, public discovery URLs, resource/audience, scopes, and algorithm/type that succeeded. Do not preselect a callback by guessing from documentation.
7. After successful registration, copy the technical ID beginning `plugin_asdk_app_`. Generate a new private package outside this checkout:

```sh
node dist/cli.js prepare-plugin --connection-id ACTUAL_REGISTERED_ID --output /absolute/path/to/new-private-plugin
```

Use a canonical absolute new directory outside the checkout, inside an owner-only private parent such as the operator directory from the installation guide. This creates root `plugin.json` and `.app.json`, both mode `0600`, in a `0700` directory, with `apps.holocron.id`. It refuses unsafe parents/existing output and never edits marketplace/Codex settings. ID validation checks syntax only; the actual connection must exist and be tested independently. The committed `.app.json` has `apps: {}` and registers nothing. Put the genuine technical ID only in the generated private package, never the distributable scaffold. On this machine, preserve `~/.gg/codex` and all unrelated settings/plugins. The [portable plugin packaging documentation](https://developers.openai.com/plugins/build/plugins) uses `extensions.com.openai.apps` to reference this mapping.

Install and enable the private plugin in the actual product surface that the intended dot can access. Local marketplace availability varies by surface. A Codex-local plugin installation does not prove that the cloud dot sees it. Refresh the connection after metadata changes and repeat the calls in a fresh actual dot conversation.

Refresh from the connection's developer settings/tool list after metadata changes; reconnect its account if OAuth expired or was revoked. Do not reset another plugin or replace global Codex settings to repair this connection. Local companion/tunnel status never establishes remote discovery or successful provider revocation. See [Recovery and disconnect](operations.md#recovery-and-disconnect) for separate stop/disconnect/provider/tunnel actions and unexpired-JWT limits.

### Private local marketplace, where supported

For the desktop Work/Codex local marketplace path documented in [Package your plugin](https://developers.openai.com/plugins/build/plugins), create a **fresh dedicated marketplace root outside the checkout**, rather than overwriting an existing personal catalog. Using the private installation variables from the operations guide:

```sh
umask 077
SC_MARKET="$SC_PRIVATE/marketplace"
mkdir "$SC_MARKET"
mkdir "$SC_MARKET/plugins"
mkdir -p "$SC_MARKET/.agents/plugins"
"$SC_NODE" "$SC_CLI" prepare-plugin --connection-id ACTUAL_REGISTERED_ID \
  --output "$SC_MARKET/plugins/holocron"
```

Create a new `"$SC_MARKET/.agents/plugins/marketplace.json"` with mode `0600` and this catalog. Relative paths are resolved from the marketplace root; no real ID or credential belongs in the catalog itself:

```json
{
  "name": "holocron-personal",
  "interface": { "displayName": "Personal Shared Clipboard" },
  "plugins": [
    {
      "name": "holocron",
      "source": { "source": "local", "path": "./plugins/holocron" },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
      "category": "Productivity"
    }
  ]
}
```

On a surface supporting the current official Codex marketplace CLI, explicitly register this new root with `codex plugin marketplace add "$SC_MARKET"`, then use `codex plugin marketplace list` to inspect it. This supported add is a separate user-run opt-in; the bridge generator never modifies Codex configuration. Keep this machine's existing `~/.gg/codex` configuration in place, and do not replace another marketplace. Restart the ChatGPT desktop app, open Plugins Directory, choose Personal Shared Clipboard, install/enable the plugin and authorize its actual connection. For updated metadata, refresh the developer connection and use a fresh chat; for a catalog update, the supported command is `codex plugin marketplace upgrade holocron-personal`.

This documented desktop path remains untested in the actual intended dot/account. If its product surface has no local marketplace support or does not expose the plugin to that dot, report that concrete compatibility gap; broad computer access or a local Inspector result cannot substitute. Removal disables/uninstalls this plugin in its actual surface and uses `codex plugin marketplace remove holocron-personal` only for this dedicated source, then deletes its own private files after inspecting them. Neither marketplace removal nor file deletion revokes the external provider/tunnel/registered connection.

The listener binds only IPv4 loopback. Host must exactly equal `127.0.0.1:<actual-port>`; forwarded-host headers are ignored. Missing Origin is accepted for nonbrowser tunnel traffic; present Origin requires an exact configured HTTPS origin. No wildcard CORS, cookie auth, query tokens, session authority, arbitrary path, generic fetch, shell, or remote clipboard capture is exposed. `/mcp` accepts one bounded UTF-8 JSON-RPC POST, with JSON responses through the official Streamable HTTP transport. GET/DELETE streaming sessions are disabled because the service is stateless. The HTTP body limit is `6 × 256 KiB + 16 KiB` for worst-case escaped text; decoded text is still limited to 256 KiB. Headers remain 8 KiB, active authorized/verification requests 16, sockets 64, and full-request deadline ten seconds. Preflight is restricted to POST and known MCP headers. The actual tunnel must preserve bearer authorization and supported MCP protocol/Accept headers and forward a loopback Host (or the boundary must be deliberately adapted and retested based on observed evidence).

When a user-supplied secret is needed, use `fidelius ask --help`, then `fidelius ask -m "..." CONTROL_PLANE_API_KEY` or the specific established-provider credential name. Fidelius returns a private temporary directory path, not the secret. Consume the file directly into the necessary local secret store/client configuration without printing it or putting the value in a shell command, repository, plugin manifest, model-visible output, or logs. A tunnel ID and OAuth client ID are identifiers, not substitutes for app-level authorization. Never ask for credentials in chat.

## Deferred actual dot acceptance

In the user's intended dot, call `get_bridge_status` and `read_synthetic_probe` with `{ "id": "phase1-marker" }` using the configured owner. Verify the result's owner-bound principal ID matches the authorized provider identity independently. The fixed text and SHA-256 digest must match. Status intentionally continues to report external capabilities as unverified: the running server cannot infer those outcomes.

Prove rejection from that same actual integration with a disconnected/unauthenticated connection, a nonowner account, missing read permission, or a revoked/expired access token, without copying bearer tokens into the conversation. Confirm no marker is returned. Record which negative case was exercised and its real error. Local JWT tests are preparation only. Record the product surface, intended dot, connected account/workspace (without secrets), technical connection/tunnel associations, dated successful tool results, and unauthorized rejection. Record how the developer connection **and** packaged registered plugin became usable there. A general ChatGPT chat, API Playground, Inspector, or local SDK client cannot replace this gate.

## Actual viewed cloud clipboard acceptance

Use an explicitly authorized task on the intended dot's cloud computer. Local shells and OS/environment inspection cannot prove viewed-session clipboard capability.

After access is provided, inspect the desktop the user actually sees and choose its helper/backend based on that session. Establish session permission and any clipboard ownership lifetime. Only then use harmless markers:

- Ask the authorized helper to write literal `holocron-phase1-paste-2026-10-04` to that graphical session's clipboard. Take over the same viewed desktop and paste into a benign text field. Record the visible exact result without submitting or executing it.
- In that same viewed session, copy `holocron-phase1-capture-2026-10-04` from a benign field. Capture it through the authorized helper and compare exact bytes. Record the visible session identity and helper result without reading unrelated existing clipboard content.

Do not declare viewed-session compatibility from `DISPLAY`, an OS name, installed commands, or a helper's exit status alone. Record the actual paste and capture, task/session, date, helper invocation and backend, access restrictions, and ownership constraints. Backend detection does not complete these live checks.

## Live compatibility records

Keep any private compatibility records in the ignored `tmp/gg/` folder. Verify provider callback/resource configuration, developer access, workspace/tunnel permissions, actual registered-plugin availability and the intended graphical session before relying on the HTTP connection. Local synthetic results cannot establish those external outcomes.
