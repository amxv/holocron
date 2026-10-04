---
title: Pair your agent & request keys
description: Authenticate the receiving computer, pair it with your Mac, and request keys privately.
order: 3
category: Use Holocron
---

Run `holocron ask` on the computer that needs the keys. You approve its request in a native Mac prompt. The command returns only a private temporary directory path, with one file per named key. The authorized program reads those files directly; values stay out of chat, model/MCP responses and clipboard snapshots.

The private **0.2.0 release and encrypted relay are live**. Actual intended receiver/native GUI acceptance is still pending. Pair your endpoints and [test a harmless value](#test-the-connection) before real keys. The Mac owner follows [pairing and service setup](secret-operations.md); the receiver needs no relay admin or tunnel credentials.

## Authenticate the receiving computer

The receiver may be macOS or Linux. It needs Node **24.21.0**, `gh`, `curl`, `tar`, `mktemp`, private local file permissions and outbound HTTPS. Bun is not required for the release installation.

Use a GitHub account granted read access to the private `amxv/holocron` repository. Have the receiving computer's human owner complete:

```sh
gh auth login --hostname github.com --git-protocol https --web
gh auth status --hostname github.com
```

A headless computer can show the device code for its human to complete in a browser. GitHub CLI uses the OS credential store when available, otherwise a local credential file that the owner must protect. Do not copy the Mac's GitHub login or send a token through chat.

For managed automation, the receiver's own trusted credential manager or CI secret store may supply `GH_TOKEN`: a repository-scoped, expiring fine-grained token or GitHub App installation token with **Contents: read** for this repository. Do not put it in command arguments or logs. An SSH clone key alone does not authenticate release API downloads.

## Install and prepare

Activate Node 24.21.0 with your existing Node manager. Run as an unprivileged user, with shell tracing off:

```sh
set -eu
set +x
umask 077
node --version   # must be v24.21.0
gh auth status --hostname github.com
hc_bootstrap=$(mktemp)
curl -fsSL https://holocron.ashray.xyz/install.sh -o "$hc_bootstrap"
sh "$hc_bootstrap" --version 0.2.0
rm "$hc_bootstrap"
HC="$HOME/.local/bin/holocron"
"$HC" --version   # must be 0.2.0
HC_KEYS="$HOME/.local/share/holocron-secret-receiver"
mkdir -p "$HC_KEYS"
"$HC" secrets prepare --directory "$HC_KEYS/pair" \
  --relay https://holocron.ashray.xyz/api/secrets \
  --recipient "My receiving agent computer"
```

Use a dedicated private `0700` parent and a fresh `pair` directory. If the parent already exists, check its owner and permissions first. The recipient label and purpose are public metadata; keep secrets out of them.

Send **only `pair/descriptor.json` and the public fingerprints printed by `prepare`** to the Mac owner. Keep `pending.json` on the receiver. Receiver credentials and private keys originate here and stay here.

## Complete pairing

The Mac owner compares your receiver fingerprint and approves the native pairing prompt. They return encrypted `enrollment.json` and a **separately confirmed Mac fingerprint**. Save the enrollment as `$HC_KEYS/enrollment.json`, mode `0600`, then complete within 15 minutes:

```sh
"$HC" secrets complete --pending-file "$HC_KEYS/pair/pending.json" \
  --enrollment-file "$HC_KEYS/enrollment.json" \
  --mac-fingerprint VERIFIED_MAC_FINGERPRINT
```

Replace the placeholder with the full 64 lowercase hexadecimal characters confirmed by the Mac owner. Do not trust a fingerprint obtained only from the enrollment file. The command creates private `pair/receiver.json` and removes the pending enrollment key. Never send `pending.json` or `receiver.json` to chat, the Mac or a model-visible file reader.

If enrollment expires, prepare a fresh directory and ask the Mac owner to revoke the incomplete pairing. Existing destinations are refused. See [pairing recovery](secret-operations.md#pairing-recovery).

## Test the connection

Keep the Mac service running and use a harmless test value. The Mac owner checks the recipient, fingerprint, purpose and expiry, then enters `holocron-acceptance-2026` and chooses **Approve and send**. Run this on the receiver; it reports only PASS or FAIL and removes the temporary files:

```sh
(
  set -eu
  set +x
  HC_TEST_DIR=$("$HC" ask --pairing-file "$HC_KEYS/pair/receiver.json" \
    -m "Harmless receiving-computer acceptance" TEST_API_KEY)
  trap '"$HC" secrets cleanup --directory "$HC_TEST_DIR" >/dev/null' EXIT
  node --input-type=module - "$HC_TEST_DIR" <<'JS'
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
try {
  const directory = process.argv[2];
  const file = join(directory, 'TEST_API_KEY');
  if (((await stat(directory)).mode & 0o777) !== 0o700 ||
      ((await stat(file)).mode & 0o777) !== 0o600 ||
      (await readFile(file, 'utf8')) !== 'holocron-acceptance-2026') throw new Error();
  console.log('PASS');
} catch { console.error('FAIL'); process.exitCode = 1; }
JS
)
```

Also observe native Cancel and receiver Ctrl+C with harmless requests before relying on the setup. The [full acceptance checklist](secret-operations.md#acceptance-on-your-devices) covers expiry, cleanup and revocation. A synthetic relay result does not prove native GUI or intended-device behavior.

## Request keys for your task

Request one to eight uppercase names with a non-secret purpose:

```sh
HC_SECRET_DIR=$("$HC" ask --pairing-file "$HC_KEYS/pair/receiver.json" \
  -m "Run my approved task" OPENAI_API_KEY)
```

The command waits for native approval and prints only the private directory path. Never display a key with `cat`, read it through model-visible tools, substitute its value into argv, enable shell tracing or log it. Each file is `0600` in a `0700` directory.

For example, for an **approved OpenAI authentication check**, this program reads the file directly, sends it only to the provider and prints status without the key or response body. Adapt the provider operation to your actual authorized task, and clean up even on failure:

```sh
(
  set -eu
  set +x
  HC_SECRET_DIR=$("$HC" ask --pairing-file "$HC_KEYS/pair/receiver.json" \
    -m "Check OpenAI authentication for my project" OPENAI_API_KEY)
  trap '"$HC" secrets cleanup --directory "$HC_SECRET_DIR" >/dev/null' EXIT
  node --input-type=module - "$HC_SECRET_DIR/OPENAI_API_KEY" <<'JS'
import { readFile } from 'node:fs/promises';
try {
  const key = await readFile(process.argv[2], 'utf8');
  const response = await fetch('https://api.openai.com/v1/models', {
    redirect: 'error', headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error();
  await response.body?.cancel();
  console.log('API authentication succeeded');
} catch { console.error('API authentication failed'); process.exitCode = 1; }
JS
)
```

## Cancel, clean up or replace a receiver

Ctrl+C cancels a pending request. Requests expire after three minutes. To remove an already received session sooner:

```sh
"$HC" secrets cleanup --directory "$HC_SECRET_DIR"
```

An independent worker deletes temporary files after five minutes. Sleep, power loss or forced termination can delay deletion; cleanup is not a secure-erasure guarantee. Pairing lasts seven days. Ask the Mac owner to [revoke it](secret-operations.md#revoke-a-receiver) and confirm the backend acknowledgement before removing your dedicated pairing files. Local deletion alone does not revoke authority. A replacement computer must create fresh keys and pair again.

## Copyable agent task

```text
Set up Holocron on the computer that needs my keys, following:
https://holocron.ashray.xyz/docs/secret-requests
Use Node 24.21.0 and this computer's own private GitHub access.
Return only the public descriptor and fingerprints for pairing.
Keep receiver credentials local. Test a harmless value first.
For my approved task, request named keys with holocron ask.
Read them only inside the program that needs them, never into chat,
model-visible tools, arguments or logs. Clean up the returned files.
```

Reference: [GitHub CLI login](https://cli.github.com/manual/gh_auth_login), [token environment](https://cli.github.com/manual/gh_help_environment), [OpenAI models API](https://platform.openai.com/docs/api-reference/models/list).
