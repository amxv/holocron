---
title: Mac setup & daily controls
description: Save setup once, pair an agent with a code, then start, inspect and stop Holocron.
order: 10
category: Reference
---

Set up once, pair each receiver with a temporary code and native approval, then use `holocron start`, `status` and `stop`.

This guide targets **0.3.1**, requiring private release publication and an update to the existing relay. Previous published releases remain immutable. Real device/native GUI acceptance is still pending.

## Mac setup

Use your existing dedicated relay admin token file: canonical absolute path, `0600`, under a `0700` parent. Supply its value through your trusted local credential workflow, such as Fidelius. No Mac GitHub, tunnel or relay credential goes to the receiver.

```sh
curl -fsSL https://holocron.ashray.xyz/setup.sh | sh -s -- \
  --admin-file /absolute/private/relay-admin-token
```

Setup installs missing pinned Node/GitHub CLI locally, verifies the private release, builds the AppKit approval helper and reuses your linked Holocron or Board config. Fresh setup creates a private STDIO config. It starts no service. Complete the native Command Line Tools installer or GitHub device login when required, then repeat setup.

Add `~/.local/bin` to PATH, or use `$HOME/.local/bin/holocron`. Repeating `holocron setup` retains the saved setup. Existing permissions, unrelated jobs and old profiles are not silently migrated.

Save your **existing local MCP tunnel** references once:

```sh
holocron setup --tunnel-profile /absolute/private/existing-tunnel.yaml \
  --tunnel-client /absolute/path/to/tunnel-client
```

The private profile retains its existing tunnel identity, control-plane settings, workspace associations and credential references. Holocron supplies the installed STDIO main command internally for its owned run. It provisions no tunnel or account. The official tunnel client/profile must already be installed and authorized. Setup resolves package-manager executable aliases such as `/opt/homebrew/bin/tunnel-client` once and saves their guarded canonical target. If a package upgrade removes that target, repeat setup with the alias to bind the new executable. Stop a manually running tunnel through its existing owner before switching supervision.

For an existing unlinked Board config, add `--local-config /absolute/private/local.json`. To reuse an existing secret pairing explicitly, add `--mac-config /absolute/private/mac.json`. `--prompt /absolute/private/helper` reuses a trusted helper; code pairing requires the 0.3.0 or later helper's `--pair-code` support. The default build supplies it.

## Pair a receiving computer

```sh
holocron pair
```

Give the printed five-minute code to your intended receiver through your trusted conversation. They run the [single setup command](secret-requests.md#install-and-pair-with-one-command) and give you eight verification digits. Enter them in the native Mac prompt, review recipient/relay/expiry, then choose **Approve pairing**. The prompt does not reveal the expected number.

One code admits one receiver proposal. Mismatch, cancellation or expiry requires a fresh code. Saved pairing lasts seven days; every key request still needs native approval. A code alone grants no lasting authority.

## Start, inspect and stop

```sh
holocron start
holocron status
holocron stop
```

`start` runs the configured tunnel and active saved secret services in the foreground. Keep its terminal/process supervisor running and the Mac awake. Ctrl+C or `stop` shuts down only that owned supervisor and its children. A repeated `start` reports the active owned runtime.

Status distinguishes configured/stopped, service failure, relay reachability and tunnel readiness. A running process does not establish remote discovery. Private loopback `/readyz` provides tunnel readiness when available; otherwise it stays unverified. Backend/tunnel failure closes active prompts and stops the owned run. Restart deliberately after recovery.

With saved setup, bare `status` and `stop` address these components. Explicit `--local-config FILE` or `--config FILE` retains the original companion contract. Without saved setup, bare status/stop retain linked-profile behavior. Clipboard, MCP, Raycast and HTTP commands remain compatible.

## Revoke a receiver

Locally identify the Mac config path from your private setup references, without displaying credential contents:

```sh
holocron secrets revoke --mac-config /absolute/private/pairings/PAIR/mac.json
```

Success is `{"revoked":true}`. Stop the service and retain its config until acknowledgement. Local deletion cannot revoke authority or erase received/downstream copies. A revoked saved service fails closed; after acknowledged revocation, remove only its reference from your private setup. Legacy explicit `secrets serve --mac-config FILE` remains available.

## Pairing recovery

| Result | Action |
| --- | --- |
| Wrong, expired or already used code | Run `holocron pair` again |
| `pairing_peer_mismatch` | Cancel, confirm the intended computer, then use a fresh session |
| `pairing_incomplete_revoke_mac_config` | Run `holocron pair --recover`; acknowledgement or actual expiry is required |
| `unsafe_tunnel_client` | Check executable ownership, write permissions and target; repeat setup with the trusted installed alias |
| Existing helper build directory after an interrupted setup | Reuse its verified helper explicitly with `--prompt`; setup never replaces that directory automatically |
| Stale owned runtime socket | Run `holocron setup --recover`, then start |
| `setup_busy_or_interrupted_inspect_setup_lock` | Verify the other setup exited, then remove only its empty private `setup.lock` directory |
| Expired receiver | Get a fresh code and repeat receiver setup with `--renew` |

Failures preserve completed pairings. Uncertain provisioning retains the new Mac credential for revocation. Receiver failures remove only their newly owned directory. No automatic retry can reopen a prompt or pick another peer.

## Relay operator reference

Reuse the configured Vercel/Upstash backend. The function needs `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` and the dedicated `HOLOCRON_SECRETS_ADMIN_TOKEN`. [Release operations](operations.md#publish-the-private-cli-release-and-installer) cover publication; preserve earlier tags/assets.

POST JSON rejects browser Origins/query strings, uses no-store responses and sanitizes backend failures. Stored state contains public commitments/keys, credential hashes, metadata and ciphertext. Disable external payload/header capture and redact Authorization.

Code sessions last five minutes with atomic one-proposal transitions, one ciphertext consumption and a 15-minute reuse tombstone. Global code traffic is bounded at 600 operations/minute. Channel quotas remain ten requests/hour and 240 operations/minute. A compromised relay can deny service. Clocks must be accurate; both endpoints need HTTPS.

## Security and expiry reference

The 20-character base32 code pins 100 bits of a SHA-256 Mac commitment covering relay, expiry, random nonce and X25519 key. The receiver commits its signed descriptor/nonce before the Mac reveals its key. Both verify commitments locally. HKDF over X25519 and the canonical transcript yields the eight-digit verification number. One native prompt accepts one attempt and never displays the expected answer.

This is a commitment-based short authentication flow, not a password protocol. A substituted receiver gets one guess per locked session, about one in 100 million. Fresh attempts require deliberate human action. Trusted delivery of the public code pins the Mac; trusted delivery and native entry of the receiver's number authenticates the receiver. Never accept relay-supplied replacements.

Enrollment binds the complete descriptor and pinned Mac key. Ed25519-signed requests and NaCl box deliveries preserve authenticated endpoint binding and secrecy with a compromised relay. Receiver credentials remain local. Names/recipient/purpose are public metadata; values are nonempty exact UTF-8 up to 4,096 bytes, without NUL or trimming.

Requests expire in three minutes; private receiving files auto-delete after five minutes. Sleep/power loss/worker termination can delay removal. Same-user malware, endpoint memory and downstream copies remain within the endpoint trust boundary; secure erasure is not promised.

The commitment rationale follows [RFC 6189 section 4.4.1.1](https://www.rfc-editor.org/rfc/rfc6189.html#section-4.4.1.1), without implementing ZRTP. The existing unsuppressed site advisory GHSA-ch52-4w7c-c8xp remains separate.

## Acceptance on your devices

1. Pair the actual receiver and observe native number entry/approval. Run the [harmless PASS/FAIL check](secret-requests.md#test-the-connection) before real values.
2. Observe native Cancel, receiver Ctrl+C, wrong code, wrong verification number and expiry. Each must fail without key files.
3. Repeat without manual cleanup and observe absence after five minutes. Sleep/worker termination can delay deletion.
4. Stop, revoke and confirm acknowledgement. The next request must fail without files. Pair fresh endpoints before real keys.

Isolated Redis, subprocess and installer tests establish their tested layers. They do not prove actual GUI, published installation, provider access or intended ChatGPT discovery.
