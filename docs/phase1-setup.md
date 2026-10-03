# Phase 1 synthetic probe and live gates

Status as of 2026-10-04: the user instructed "skip live make it", so implementation continues with live gates deferred. Explicit text sharing, Mac clipboard writes and selected UTF-8 context file snapshots are implemented; see [Text bridge usage](text-bridge.md) and [Selected context files](context-files.md). No provider is selected or verified. No real connection, OAuth callback/resource setting, intended dot call/file reconstruction, real Mac editor test, or viewed cloud clipboard paste/capture has passed. Local tests do not establish these facts.

## Install and check

The runtime is pinned to Node `24.21.0` (LTS), npm `11.19.0`, the official `@modelcontextprotocol/sdk` `1.32.0`, `jose` `6.2.12`, and Zod `4.6.5`. TypeScript is `7.0.2`. Versions were checked against current package manifests and [Node releases](https://nodejs.org/en/about/previous-releases). The lockfile pins transitive dependencies.

```sh
mise exec node@24.21.0 -- npm ci
mise exec node@24.21.0 -- npm run check
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
3. Install the official full `tunnel-client` from the OpenAI Homebrew tap on macOS (`brew install openai/tools/tunnel-client`), or follow Platform settings/the latest official release for your platform. The current full client `0.0.15` was downloaded to a temporary directory, checked against the release SHA-256, and its help/sample commands inspected during preparation. No permanent installation, profile, tunnel, or runtime was created. Start with `tunnel-client help quickstart`. The HTTP/OAuth starter is `sample_mcp_with_dcr`; its name does not select or verify a DCR provider. Use a fresh profile directory/name, without `--force`:

```sh
tunnel-client init --sample sample_mcp_with_dcr --profile shared-clipboard-probe \
  --profile-dir /absolute/path/to/new-private-profile-directory \
  --tunnel-id ACTUAL_TUNNEL_ID --mcp-server-url http://127.0.0.1:4317/mcp \
  --control-plane-api-key-ref env:CONTROL_PLANE_API_KEY --health-listen-addr 127.0.0.1:0
```

Add only the actual canonical resource/metadata origin and external provider discovery origins to `mcp.oauth_trusted_origins` in this new profile before running `doctor --profile shared-clipboard-probe --profile-dir /absolute/path/to/new-private-profile-directory --explain` and `run` with the same profile/directory. Current client discovery otherwise trusts only the configured loopback MCP origin. The runtime also exposes repeatable `--mcp.oauth-trusted-origin` flags for those exact origins. Keep unsafe raw HTTP logging, payload capture, remote admin UI, generic proxy/Harpoon targets, and static MCP Authorization overrides disabled. User bearer tokens must reach the probe intact; no shared static bearer token substitutes for owner OAuth. No unrelated profile or configuration is changed.
4. Keep the probe and tunnel client running. With GG, launch long-lived services using managed processes. The tunnel runtime key is only for the tunnel client; it is not a user bearer token for this MCP server.
5. Add the developer connection at ChatGPT Plugins, choose Tunnel, select the actual tunnel, and review discovered tools. Establish the canonical resource identifier used by this connection/provider and verify OAuth discovery through the tunnel. Do not invent an endpoint or assume the tunnel's forwarding of Host/Origin/token headers works before the live test.
6. Copy the **exact** OAuth redirect URI displayed on the connection's management page into the provider allowlist. Current docs describe stable redirects only for providers satisfying issuer identification; others use a callback-specific URI. Record the actual URI, registration mode, public discovery URLs, resource/audience, scopes, and algorithm/type that succeeded. Do not preselect a callback by guessing from documentation.
7. After successful registration, copy the technical ID beginning `plugin_asdk_app_`. Generate a new private package outside this checkout:

```sh
node dist/cli.js prepare-plugin --connection-id ACTUAL_REGISTERED_ID --output /absolute/path/to/new-private-plugin
```

This creates an owner-only directory with root `plugin.json` and `.app.json` containing `apps.shared-clipboard-probe.id`. It never overwrites an existing folder or edits marketplace/Codex settings. The committed `.app.json` has `apps: {}` and does not register a connection. Put the real technical ID only into the generated private package, never the distributable scaffold. The [portable plugin packaging documentation](https://developers.openai.com/plugins/build/plugins) uses `extensions.com.openai.apps` to reference this mapping.

Install and enable the private plugin in the actual product surface that the intended dot can access. Local marketplace availability varies by surface. A Codex-local plugin installation does not prove that the cloud dot sees it. Refresh the connection after metadata changes and repeat the calls in a fresh actual dot conversation.

The listener binds only IPv4 loopback. Host must exactly equal `127.0.0.1:<actual-port>`; forwarded-host headers are ignored. Missing Origin is accepted for nonbrowser tunnel traffic; present Origin requires an exact configured HTTPS origin. No wildcard CORS, cookie auth, query tokens, session authority, arbitrary path, generic fetch, shell, or remote clipboard capture is exposed. `/mcp` accepts one bounded UTF-8 JSON-RPC POST, with JSON responses through the official Streamable HTTP transport. GET/DELETE streaming sessions are disabled because the service is stateless. Phase 2's body limit is `6 × 256 KiB + 16 KiB` for worst-case escaped text; decoded text is still limited to 256 KiB. Headers remain 8 KiB, active authorized/verification requests 16, sockets 64, and full-request deadline ten seconds. Preflight is restricted to POST and known MCP headers. The actual tunnel must preserve bearer authorization and supported MCP protocol/Accept headers and forward a loopback Host (or the boundary must be deliberately adapted and retested based on observed evidence).

When a user-supplied secret is needed, use `fidelius ask --help`, then `fidelius ask -m "..." CONTROL_PLANE_API_KEY` or the specific established-provider credential name. Fidelius returns a private temporary directory path, not the secret. Consume the file directly into the necessary local secret store/client configuration without printing it or putting the value in a shell command, repository, plugin manifest, model-visible output, or logs. A tunnel ID and OAuth client ID are identifiers, not substitutes for app-level authorization. Never ask for credentials in chat. No credential prompt was opened during preparation because no provider/tunnel connection was selected or available to test.

## Deferred actual dot acceptance

In the user's intended dot, call `get_bridge_status` and `read_synthetic_probe` with `{ "id": "phase1-marker" }` using the configured owner. Verify the result's owner-bound principal ID matches the authorized provider identity independently. The fixed text and SHA-256 digest must match. Status intentionally continues to report external capabilities as unverified: the running server cannot infer those outcomes.

Prove rejection from that same actual integration with a disconnected/unauthenticated connection, a nonowner account, missing read permission, or a revoked/expired access token, without copying bearer tokens into the conversation. Confirm no marker is returned. Record which negative case was exercised and its real error. Local JWT tests are preparation only. Record the product surface, intended dot, connected account/workspace (without secrets), technical connection/tunnel associations, dated successful tool results, and unauthorized rejection. Record how the developer connection **and** packaged registered plugin became usable there. A general ChatGPT chat, API Playground, Inspector, or local SDK client cannot replace this gate.

## Actual viewed cloud clipboard acceptance

Use an explicitly authorized task on the intended dot's cloud computer. No cloud task or viewed session API was supplied to this implementer; local shells and OS/environment inspection cannot prove cloud capability. Broad personal-computer access and computer-use automation are not authorized.

After access is provided, inspect the desktop the user actually sees and choose its helper/backend based on that session. Establish session permission and any clipboard ownership lifetime. Only then use harmless markers:

- Ask the authorized helper to write literal `shared-clipboard-phase1-paste-2026-10-04` to that graphical session's clipboard. Take over the same viewed desktop and paste into a benign text field. Record the visible exact result without submitting or executing it.
- In that same viewed session, copy `shared-clipboard-phase1-capture-2026-10-04` from a benign field. Capture it through the authorized helper and compare exact bytes. Record the visible session identity and helper result without reading unrelated existing clipboard content.

Do not declare viewed-session compatibility from `DISPLAY`, an OS name, installed commands, or a helper's exit status alone. Record the actual paste and capture, task/session, date, helper invocation and backend, access restrictions, and ownership constraints. A later helper may support documented standard backends under the user's amended scope; backend detection does not complete these live checks.

## Deferred evidence

Phase 1's live acceptance remains incomplete until actual Dots authorization/connection/plugin and viewed cloud paste/capture pass. The latest user amendment defers these installation tests and authorizes subsequent implementation with local checks. Keep private compatibility records in the primary checkout's ignored `tmp/gg/` folder. Unknown values remain explicitly unknown, and real use requires the unavailable provider, callback/resource, developer access, workspace/tunnel permissions, actual registered-plugin surface and graphical session to be established. No relay, invented credentials or local mock evidence substitutes for those facts.
