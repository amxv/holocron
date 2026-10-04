---
title: Mac pairing & secret service
description: Approve receiver pairing, run the native Mac service, revoke access and test your devices.
order: 10
category: Reference
---

This is the Mac owner's setup for [private API key requests](secret-requests.md). The receiving agent follows that separate guide and needs none of the relay's admin/provider credentials.

The private `holocron-v0.2.0` release is published and installed, and the relay at `https://holocron.ashray.xyz/api/secrets` is deployed. A production synthetic ciphertext/consume/replay/revoke probe passed. Actual intended receiver/native GUI acceptance is still pending. Keep real keys out of acceptance tests.

## Mac prerequisites

Install [Node 24.21.0 and the verified CLI](getting-started.md#install-holocron). The native prompt needs macOS AppKit, the graphical login session and Xcode Command Line Tools' `/usr/bin/swiftc`. If absent, have the human run `xcode-select --install`. Both endpoints need accurate clocks and outbound HTTPS. Keep the Mac awake while serving requests.

The operator must already have the relay's dedicated admin token in a canonical Mac-local regular `0600` file under a `0700` parent. Use your trusted local credential workflow, such as Fidelius. Never put it in chat, argv or URLs. Use a private setup parent outside the repository and separate from context/Board state.

## Pair a receiving computer

First ask the receiver to [prepare its public descriptor](secret-requests.md#install-and-prepare). Save **only that public descriptor** locally and compare the full receiver fingerprint through your authenticated conversation. Then:

```sh
set +x
umask 077
HC="$HOME/.local/bin/holocron"
HC_KEYS="$HOME/.local/share/holocron-secret-operator"
mkdir -p "$HC_KEYS"
"$HC" secrets build-prompt --directory "$HC_KEYS/prompt"
# Save the public descriptor as HC_KEYS/descriptor.json (0600).
"$HC" secrets pair --directory "$HC_KEYS/pair" \
  --descriptor-file "$HC_KEYS/descriptor.json" \
  --receiver-fingerprint VERIFIED_RECEIVER_FINGERPRINT \
  --prompt "$HC_KEYS/prompt/holocron-secrets-ui" \
  --admin-file "$HC_KEYS/relay-admin-token"
```

Use a fresh `prompt` and `pair` directory; existing destinations are refused. Check the dedicated parent's owner and `0700` mode if it already exists. The admin file must already contain the token. Replace `VERIFIED_RECEIVER_FINGERPRINT` with the full 64 lowercase hexadecimal characters confirmed by the intended receiver.

The native prompt displays public fingerprints, relay, recipient and expiry. Verify them and choose **Approve pairing**. Denial or expiry provisions nothing. Return **only `pair/enrollment.json` and the independently confirmed Mac fingerprint** to the receiver. They complete enrollment within 15 minutes.

Fingerprints identify keys, not hardware. Your authenticated conversation establishes which computer is intended. `mac.json` stays on the Mac; `receiver.json` and `pending.json` stay on the receiver. No receiver private credential is copied from the Mac.

## Serve and approve requests

Run the foreground service with your paired Mac config:

```sh
"$HC" secrets serve --mac-config "$HC_KEYS/pair/mac.json"
```

For each request, review the recipient, fingerprint, key names, non-secret purpose and expiry. Enter values in the native secure fields and choose **Approve and send**, or cancel. The service encrypts values for that request's receiver. It is independent of the context companion and tunnel.

The service polls every 30 seconds when idle and every two seconds while a prompt is open. Run it only when needed. A stopped/asleep Mac cannot approve a request. A crashed service can leave a claim unavailable until expiry; submit a deliberate fresh request. Stopping the service closes its prompt without changing your tunnel or clipboard.

## Revoke a receiver

```sh
"$HC" secrets revoke --mac-config "$HC_KEYS/pair/mac.json"
```

Success is `{"revoked":true}`. It removes the pairing's server authority and current ciphertext, but cannot erase received files or downstream copies. Stop the service and retain the private Mac config until revocation is acknowledged. Local file deletion is not server revocation.

If the backend is unavailable or quota-exhausted, do not claim revocation succeeded. For urgent cutoff, the authorized operator can remove the dedicated channel/database through provider controls. Each new computer needs fresh receiver-generated keys and a separate pairing.

## Pairing recovery

| Result | Action |
| --- | --- |
| Enrollment expired | Prepare fresh receiver enrollment and revoke the incomplete Mac pairing |
| `pairing_incomplete_revoke_mac_config` | Revoke the retained new `pair/mac.json`, confirm acknowledgement, then use fresh receiver/Mac directories |
| `pairing_exists` | Do not infer readiness; inspect the intended setup and recover through acknowledged revocation |
| `paired_pending_cleanup_failed` | A receiver config was created; remove only its old local pending file before use |

`provision --mac-config FILE --admin-file FILE` remains available for deliberately managed legacy configs. It does not transfer receiver credentials.

## Relay operator reference

Static docs need no secrets. The separate Node function at `/api/secrets` needs these three private environment variables:

| Variable | Source |
| --- | --- |
| `UPSTASH_REDIS_REST_URL` | Dedicated Redis database's HTTPS REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | Dedicated database's REST token |
| `HOLOCRON_SECRETS_ADMIN_TOKEN` | Dedicated random 32-byte unpadded base64url token, exactly 43 characters |

The Mac admin file holds the same dedicated admin token. Keep all values outside source/public assets, and separate from tunnel/provider credentials. For a new deployment, use a dedicated database, human-approved provider terms and a plan with automatic paid upgrades disabled. Follow [release/deployment operations](operations.md#publish-the-private-cli-release-and-installer) and `site/README.md` in the source checkout.

The relay accepts POST JSON, rejects browser Origin headers/query strings and returns `Cache-Control: no-store`. Disable external payload/header capture and redact Authorization in provider logging. It retains public keys, credential hashes, request metadata and ciphertext, never entered key plaintext or endpoint private keys.

One continuously idle service makes approximately 388,800 Redis commands per 30 days; one idle hour/day makes about 16,200, with roughly 1,200 for a full three-minute active request. These are source-derived estimates, not measured production usage. Check actual provider usage and plan limits. Quotas of ten new requests/hour and 240 authenticated operations/minute per pairing do not guarantee monthly capacity under abuse.

Redis calls have a five-second deadline; API invocations a 15-second cap. SDK retries, telemetry, latency logging and automatic pipelining are disabled. Quota/backend failure closes prompts and fails safely. The unsuppressed site advisory **GHSA-ch52-4w7c-c8xp** stays a separate dependency audit issue.

## Security and expiry reference

| Setting | Limit |
| --- | --- |
| Names per request | One to eight distinct `[A-Z][A-Z0-9_]{0,63}` identifiers |
| Value | Nonempty exact UTF-8, up to 4,096 bytes, no NUL; no trimming |
| Purpose / recipient | 500 / 64 characters; public metadata, no values |
| Enrollment / pairing | 15 minutes / seven days |
| Request / temporary files | Three minutes / five minutes |
| Receiver permissions | Directories `0700`, files `0600` |

Signed descriptors and independently verified fingerprints bind encrypted enrollment to the intended endpoint. Ed25519 signs requests; NaCl box encrypts each delivery to a fresh request-specific receiving key and the pinned Mac key. Atomic transitions enforce claim, consumption, cancellation, expiry and replay protection. Historical wire domains/Redis prefixes remain compatible.

There is no plaintext fallback, offline queue or automatic retry prompt. Cancellation destroys the ephemeral receiver key and sends a best-effort cancellation. Uncertain consumption requires a deliberate new request. An independent cleanup worker must acknowledge readiness before a key directory is returned.

Sleep/power loss/worker termination can delay deletion. Endpoint memory, private files and authorized downstream use hold plaintext within that OS owner's trust boundary. Same-user malware can access it; memory erasure, SSD secure deletion and removal of downstream copies are not guaranteed.

## Acceptance on your devices

Record results privately without credentials. Keep real keys out of this test:

1. Pair the actual receiver, observe native Mac approval and run the [harmless PASS/FAIL check](secret-requests.md#test-the-connection). Confirm `0700` directory/`0600` file permissions and acknowledged cleanup.
2. Repeat without manual cleanup; confirm absence after five minutes during a later normal observation. Sleep or worker termination can delay removal.
3. Observe Mac Cancel, receiver Ctrl+C while the prompt is open, and expiry without approval. Each must fail safely with no returned key directory and prompt closure.
4. Stop the service, revoke and confirm `{"revoked":true}`. The next receiver request must fail with no files. Re-pair before real keys.

Only observed outcomes establish native GUI and actual receiver acceptance. Production synthetic relay probes and isolated subprocess fixtures cover their own layers.
