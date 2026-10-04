---
title: Private API key requests
description: Pair a receiving computer and request API keys through a secure native Mac prompt.
order: 9
category: Use Holocron
---

`holocron ask` blocks on the receiving computer until you approve named keys in a native Mac prompt. The prompt shows the recipient, fingerprint, request, purpose and expiry. Success prints only a receiving-computer temporary directory path, with one private file per key. Keys never enter chat, model/MCP responses, relay plaintext, logs, command arguments, URLs or clipboard snapshots.

**The 0.2.0 release, relay deployment and real cross-computer acceptance are pending operator work.** Upstash setup stopped before terms acceptance; no database or environment variables are established. Source tests do not establish a live service. Keep published `board-v0.1.0` and `holocron-v0.1.1` assets unchanged. The repository and release bundle remain private.

## Receiving-agent handoff

Copy this section to the intended agent after the operator confirms the private `holocron-v0.2.0` release and `https://holocron.ashray.xyz/api/secrets` are ready:

> Install Holocron on your own macOS or Linux computer as an unprivileged user. Prerequisites: Node **24.21.0**, GitHub CLI `gh`, `curl`, `tar`, `mktemp`, private local file permissions and outbound HTTPS to GitHub/the relay. Use your existing Node manager to activate that exact version. The verified release bundle already contains production dependencies; Bun is needed only for source development, not this receiving installation. Never request an existing Mac, tunnel, provider or GitHub token through chat.
>
> Authenticate **on this computer** with a GitHub account granted read access to private `amxv/holocron`. Preferred: ask its human owner to run `gh auth login --hostname github.com --git-protocol https --web`, complete the browser/device flow, then `gh auth status --hostname github.com`. A headless computer can use the displayed device flow with the human's browser. GitHub CLI uses the OS credential store when available, otherwise a local credential file, which the owner must protect. A repository-scoped, expiring fine-grained token or GitHub App installation token can instead be injected as `GH_TOKEN` by the receiver's own trusted credential manager or CI secret store, with **Contents: read** permission for this repository. Do not paste tokens into chat, shell arguments or logs, or copy the Mac's GitHub login. Fine-grained tokens should use `GH_TOKEN`, following GitHub CLI's guidance. An SSH clone key alone does not authenticate release API downloads.
>
> Run setup with shell tracing disabled. Exchange only `descriptor.json` and its public fingerprints with the Mac operator. Keep `pending.json` local. Ask the operator to compare your receiver fingerprint and approve the native pairing prompt. They return only encrypted `enrollment.json` and their independently confirmed public Mac fingerprint. Save that enrollment in `$HC_KEYS/enrollment.json` with mode `0600`; never use a fingerprint taken solely from an untrusted enrollment file. Complete pairing within 15 minutes, otherwise prepare a fresh directory and ask the operator to revoke any incomplete pairing.

```sh
set +x
umask 077
node --version                          # must be v24.21.0
curl -fsSL https://holocron.ashray.xyz/install.sh -o /tmp/holocron-install.sh
sh /tmp/holocron-install.sh --version 0.2.0
rm /tmp/holocron-install.sh
HC="$HOME/.local/bin/holocron"
"$HC" --version                         # must be 0.2.0
HC_KEYS="$HOME/.local/share/holocron-secret-receiver"
mkdir -p "$HC_KEYS"                    # private 0700 parent; use a fresh dedicated path
"$HC" secrets prepare --directory "$HC_KEYS/pair" \
  --relay https://holocron.ashray.xyz/api/secrets --recipient "My receiving agent computer"
# Send ONLY pair/descriptor.json and the returned public fingerprints to the operator.
# Save their encrypted enrollment as HC_KEYS/enrollment.json; compare the Mac fingerprint.
"$HC" secrets complete --pending-file "$HC_KEYS/pair/pending.json" \
  --enrollment-file "$HC_KEYS/enrollment.json" --mac-fingerprint VERIFIED_MAC_FINGERPRINT
```

> `VERIFIED_MAC_FINGERPRINT` is the 64 lowercase hex characters confirmed by the Mac operator. Setup exchanges public keys, credential hashes, signatures and authenticated ciphertext; it needs no existing private file-transfer channel. All receiver credentials/private keys originate and stay on this computer. `complete` exclusively creates `pair/receiver.json` and removes the pending enrollment private key. It refuses replay or an existing receiver file. Protect `receiver.json` as a credential; send neither it nor `pending.json` to the Mac or a model.
>
> Request named keys with a non-secret purpose using the single blocking command below. The human enters the value on the Mac. Keep tool output to paths/status only. Never read a key file with model-visible file tools, `cat`, shell substitution into argv, tracing or debug logs. For this concrete example, after harmless acceptance, ask for an OpenAI key and use it only for the approved HTTPS models API call. The Node program reads the file directly in process memory, sends the authorization header to the approved provider and prints only success/failure. It emits neither the key nor the response body. Adapt the provider call to your actual approved task. Run cleanup even when that call fails.

```sh
set +x
HC_SECRET_DIR=$("$HC" ask --pairing-file "$HC_KEYS/pair/receiver.json" \
  -m "Check OpenAI models API authentication for my requested project" OPENAI_API_KEY) || exit 1
trap '"$HC" secrets cleanup --directory "$HC_SECRET_DIR" >/dev/null' EXIT
node --input-type=module - "$HC_SECRET_DIR/OPENAI_API_KEY" <<'JS'
import { readFile } from 'node:fs/promises';
try {
  const key = await readFile(process.argv[2], 'utf8');
  const response = await fetch('https://api.openai.com/v1/models', {
    redirect: 'error', headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error();
  await response.body?.cancel();
  console.log('API authentication succeeded');
} catch { console.error('API authentication failed'); process.exitCode = 1; }
JS
```

> Ctrl+C cancels a pending request. Files auto-delete after five minutes through an acknowledged cleanup worker; `"$HC" secrets cleanup --directory "$HC_SECRET_DIR"` removes them sooner and acknowledges success. Power loss, sleep or forced worker termination can delay deletion; this is no secure-erasure guarantee. Do not retain downstream copies unless the task explicitly needs them. Pairing lasts seven days. For revocation, ask the Mac operator to run the command below and confirm its successful acknowledgement, then remove only your dedicated `pair/receiver.json`, any failed `pair/pending.json`, descriptor and enrollment copies. Local deletion alone does not revoke server authority. Replacement computers must create fresh keys and pair again.

## Operator prerequisites

The operator needs private repository/release access, Vercel access to the existing Holocron project/domain, an Upstash account with terms accepted by the human, and a **new dedicated free Redis database**. Select the free plan, disable automatic paid upgrades and Prod Pack, and keep tunnel credentials separate. No tunnel or existing clipboard/state migration is required. The receiving agent needs none of these provider/admin credentials.

Provide just these three private Vercel function environment variables:

| Variable | Operator source |
| --- | --- |
| `UPSTASH_REDIS_REST_URL` | Dedicated database's HTTPS REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | Dedicated database's REST authorization token |
| `HOLOCRON_SECRETS_ADMIN_TOKEN` | Dedicated random 32-byte unpadded base64url token, exactly 43 characters |

Keep the same admin token in a canonical Mac-local regular `0600` file under a `0700` parent. Use your approved local credential workflow, such as Fidelius, to populate the file/environment; do not display the token or pass it through chat, argv or URLs. These are new relay credentials, not copies of tunnel/runtime/provider authentication. There are no existing values to discover. The native Mac prompt needs AppKit, the graphical login session and Xcode Command Line Tools' `/usr/bin/swiftc`; run `xcode-select --install` yourself if absent. Both computers need accurate clocks and outbound HTTPS. The Mac must be awake while serving requests.

Build/publish the new private 0.2.0 bundle and deploy the matching site/API from approved content using [release operations](operations.md#publish-the-private-cli-release-and-installer). Source tooling uses Bun **1.4.0** with independent frozen `bun.lock` files; installed CLI processes retain Node **24.21.0**. Vercel Root Directory remains `site`, outside-root source inclusion enabled, Node 24.x, install `bun install --frozen-lockfile`, build `bun run build`, output `dist`. `site/api/secrets.ts` is the dedicated Node function at `/api/secrets`; the documentation remains static. The function imports shared relay code from root `src/`. Missing configuration returns a safe failure.

Disable external request-body/header capture, redact Authorization in any provider logging, and apply the hosting provider's endpoint firewall controls. The API emits no diagnostics, accepts POST JSON only, rejects browser Origin headers/query strings and returns `Cache-Control: no-store`. No plaintext API key reaches it. Idle polls and rejected credential attempts can still consume database commands. The known unsuppressed Astro development dependency advisory remains a separate audit decision; this API adds no shared authenticated HTTP cache or remote image reuse path.

## Mac pairing and serving

Install the verified 0.2.0 CLI on the Mac. Use a fresh dedicated private setup parent, outside the repository and separate from existing Holocron/Board state. These commands start no tunnel and read no clipboard:

```sh
set +x
umask 077
HC="$HOME/.local/bin/holocron"
HC_KEYS="$HOME/.local/share/holocron-secret-operator"
mkdir -p "$HC_KEYS"
"$HC" secrets build-prompt --directory "$HC_KEYS/prompt"
# Save the receiver's PUBLIC descriptor as HC_KEYS/descriptor.json (0600).
# Compare RECEIVER_FINGERPRINT with the intended receiver through your authenticated conversation.
"$HC" secrets pair --directory "$HC_KEYS/pair" --descriptor-file "$HC_KEYS/descriptor.json" \
  --receiver-fingerprint VERIFIED_RECEIVER_FINGERPRINT \
  --prompt "$HC_KEYS/prompt/holocron-secrets-ui" --admin-file "$HC_KEYS/relay-admin-token"
# Review and explicitly approve the native pairing prompt; it displays both public fingerprints.
# Return only pair/enrollment.json and the independently confirmed Mac fingerprint to that receiver.
"$HC" secrets serve --mac-config "$HC_KEYS/pair/mac.json"
```

The admin file must already contain the dedicated token. `VERIFIED_RECEIVER_FINGERPRINT` is the full 64-character lowercase hex fingerprint from that receiver. `pair` verifies its signed public descriptor, displays receiver/descriptor/Mac fingerprints, relay, label and expiry, and requires a distinct **Approve pairing** action before provisioning. Denial or expiry provisions nothing. The receiver independently checks the Mac fingerprint before decrypting enrollment. Fingerprints identify keys, not hardware attestation; the human's authenticated conversation establishes which computer is intended. Do not simply accept substituted fingerprints from an unknown sender.

`prepare` generates the receiver bearer credential, Ed25519 signing key and temporary Curve25519 enrollment key on the receiver. The Mac receives their public descriptor, generates only its own bearer credential/encryption key, provisions public keys/token hashes and encrypts enrollment to the receiver. Authenticated Curve25519-XSalsa20-Poly1305 encryption and the verified Mac fingerprint bind the returned channel to the exact signed descriptor. Enrollment includes no admin token, Mac bearer token, receiver bearer token or private key. Neither credential needs private cross-computer delivery. `mac.json` stays on the Mac; `receiver.json` stays on the receiver.

All setup destinations are exclusive and private; existing directories/files are refused. If provisioning becomes uncertain, `pair` reports `pairing_incomplete_revoke_mac_config` and retains only its new `pair/mac.json` for revocation. It never claims success or exposes enrollment on that failure. Revoke that exact config, confirm the acknowledgement, then use a fresh receiver enrollment and fresh Mac pairing directory. Do not infer readiness from `pairing_exists`. `paired_pending_cleanup_failed` means a receiver config was created but the old pending file could not be removed; delete only that pending file locally before use. `provision --mac-config FILE --admin-file FILE` is available for deliberately managed legacy configs and never generates/transfers receiver credentials.

`serve` is a separate operator-managed foreground process. It announces recipient/fingerprint once, polls every 30 seconds when idle and monitors an open prompt every two seconds. Incoming signed requests bind the receiver, fresh ephemeral receiving key, names, purpose and three-minute deadline. The operator-pinned helper never comes from remote input. The human's **Approve and send** action releases only that request's values. Several sidecars cannot claim one request twice. A crashed sidecar leaves its claimed request unavailable until expiry; submit a deliberate fresh request. Use a separate pairing per computer. Stopping the sidecar closes its native prompt and leaves existing tunnel/clipboard behavior intact.

Revoke a pairing on the Mac:

```sh
"$HC" secrets revoke --mac-config "$HC_KEYS/pair/mac.json"
```

Success is `{"revoked":true}`. This atomically removes channel authority/current ciphertext; it does not erase already received files or downstream copies. An unavailable or quota-exhausted relay cannot acknowledge revocation. Stop the sidecar, retain its private config until revocation succeeds, and have the operator delete the dedicated channel/database through its authorized provider controls if urgent. Do not report local file removal as server revocation.

## Security, expiry and capacity

Names are distinct uppercase identifiers `[A-Z][A-Z0-9_]{0,63}`; request one to eight. Each entered value is nonempty exact UTF-8, at most 4,096 bytes, with no NUL; no trimming/framing newline is added. Purpose is at most 500 characters, recipient at most 64. Purpose, names, labels, fingerprints, request IDs and deadlines are public metadata; never put values in them. Display controls/bidirectional overrides are rejected.

Ed25519 signatures authenticate requests. NaCl `box` authenticates each delivery against the pinned Mac key and a fresh recipient encryption key, with fresh random nonces. The ciphertext also binds the full original request. Recipient, purpose, names, request ID, sender-key or ciphertext mutations fail. The relay holds public keys, credential hashes, metadata and ciphertext only. Existing Board version-one wire domain/Redis prefix are deliberately retained for compatibility. No secret operations use ordinary snapshots, MCP, the cloud clipboard helper or arbitrary remote file delivery.

Atomic Redis transitions enforce one active request, one claim, one consumption, cancellation, deadline and replay tombstones. Request state/ciphertext expires at the three-minute deadline; channel authority expires after seven days. Consumed/cancelled deliveries cannot replay. Cancellation destroys the ephemeral receiver key and sends a best-effort cancellation; the Mac closes prompts on cancellation, expiry, backend failure or shutdown. Uncertain consumption yields no retry of the same result; request afresh deliberately. There is no plaintext fallback, offline queue or automatic retry prompt.

Receiver directories are `0700`, files `0600`. An independent worker acknowledges cleanup readiness before a path is returned. Failure to start it deletes the files and fails the command. Sleep/power loss/worker termination can delay cleanup; clean the exact returned session when finished. Private files, endpoint memory and explicitly authorized provider/tool use hold plaintext within that OS owner's trust boundary. Same-user malware or a compromised endpoint can access it; memory erasure, SSD secure deletion and removing downstream copies are not guaranteed.

Upstash currently documents **500,000 commands/month and 256 MB** for the free plan. Source-derived estimates for one pairing are approximately 388,800 commands per 30 days of continuously idle serving, 16,200 for one idle hour/day, plus roughly 1,200 for a full three-minute active request. These include EVAL/Lua operations and are not measured production usage. Run the sidecar only when needed, keep paid upgrades disabled and verify actual provider counters after deployment. Fixed application quotas are ten new requests/hour and 240 authenticated relay operations/minute per pairing; they do not guarantee monthly capacity under abuse. SDK retries/telemetry/latency logging/automatic pipelining are disabled; Redis calls have a five-second deadline, API invocations a 15-second cap. Quota/backend failure closes prompts and fails safely. Static docs and the separate clipboard MCP remain independent.

## Harmless cross-computer acceptance

After deployment, pair the actual receiving computer using the public exchange above. Keep real API keys out of this test:

1. Run `holocron ask --pairing-file "$HC_KEYS/pair/receiver.json" -m "Harmless cross-computer acceptance" TEST_API_KEY` on the receiver, capturing its directory path. On the Mac confirm the intended recipient, fingerprint, name/purpose and expiry; type the harmless value `holocron-acceptance-2026` and approve.
2. On the receiver run the check below through its local shell. Expect only `acceptance passed`, with no entered value in any CLI/model output. Observe no clipboard/snapshot operation. Run `holocron secrets cleanup --directory "$HC_TEST_DIR"` and confirm the directory disappears. Repeat once without manual cleanup and verify its absence after five minutes using the receiving computer's normal later observation, without polling indefinitely.
3. Make another harmless request and choose native Cancel, then another and press Ctrl+C on the receiver while the prompt is open. Confirm safe failure/no directory and closure of the native prompt. Let one request expire without approval and confirm the same outcome.
4. Stop the sidecar, revoke the Mac config and confirm `{"revoked":true}`. A receiver's next ask must fail with no files. Re-pair before using real keys. This procedure establishes native GUI and real remote acceptance only when the human observes those outcomes; subprocess fixtures alone do not.

```sh
HC_TEST_DIR=$("$HOME/.local/bin/holocron" ask --pairing-file "$HC_KEYS/pair/receiver.json" \
  -m "Harmless cross-computer acceptance" TEST_API_KEY) || exit 1
node --input-type=module - "$HC_TEST_DIR" <<'JS'
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
try {
  const directory = process.argv[2]; const file = join(directory, 'TEST_API_KEY');
  if (((await stat(directory)).mode & 0o777) !== 0o700 || ((await stat(file)).mode & 0o777) !== 0o600 ||
      (await readFile(file, 'utf8')) !== 'holocron-acceptance-2026') throw new Error();
  console.log('acceptance passed');
} catch { console.error('acceptance failed'); process.exitCode = 1; }
JS
```

Local gates use an isolated real Redis executable (with sibling `redis-cli`), isolated Mac/receiver homes and injected prompt values. No secret test is silently skipped when Redis is absent; it fails with the missing prerequisite. The canonical check runs package/release/installer, Raycast and Astro diagnostics without an extra site build:

```sh
HOLOCRON_TEST_REDIS_SERVER=/absolute/test/redis-server bun run check
HOLOCRON_TEST_REDIS_SERVER=/absolute/test/redis-server bun run secret:regression
/usr/bin/swiftc -typecheck native/HolocronSecrets.swift
bun audit
bun audit --cwd site --audit-level=low
```

Sources checked October 4, 2026: [GitHub CLI login](https://cli.github.com/manual/gh_auth_login), [GitHub token environment](https://cli.github.com/manual/gh_help_environment), [GitHub API authentication](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github), [OpenAI models API](https://platform.openai.com/docs/api-reference/models/list), [TweetNaCl.js](https://github.com/dchest/tweetnacl-js), [Vercel Node functions](https://vercel.com/docs/functions/runtimes/node-js), [Upstash pricing](https://upstash.com/pricing/redis).
