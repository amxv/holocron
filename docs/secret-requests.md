---
title: Pair your agent & request keys
description: One receiver setup command, native Mac approval, then use your saved pairing.
order: 3
category: Use Holocron
---

Run `holocron ask` on the computer that needs the keys. Approve each request in a native Mac prompt. The command returns only a private temporary directory path containing one file per named key. The authorized program reads those files directly; values stay out of chat, model/MCP responses and clipboard snapshots.

This guide targets **0.3.4** and its public GitHub release. Actual receiver/native GUI acceptance remains pending. The Mac owner follows [Mac setup](secret-operations.md).

## Receiving computer prerequisites

Setup downloads the public `amxv/holocron` release anonymously and installs missing pinned Node in a private user directory. It reuses an available Node **24.21.0**. Bun, GitHub authentication and sudo are unnecessary. Linux must support the official Node binary and its glibc requirements; unsupported systems fail without changing system packages.

## Install and pair with one command

Ask the Mac owner to run `holocron pair`. Replace `MAC_PAIRING_CODE` with their temporary code:

```sh
curl -fsSL https://holocron.ashray.xyz/setup.sh | sh -s -- receiver --code MAC_PAIRING_CODE
```

Run as your regular OS user with shell tracing off. You need `curl`, `tar`, `mktemp` and a SHA-256 utility. The unique public pairing code expires after fifteen minutes.

Setup prints an **eight-digit verification number**. Give it to the Mac owner through your trusted conversation. They enter it in the native pairing prompt and approve. A wrong number cancels the session. Neither endpoint accepts the relay's claim about peer identity.

Receiver signing keys and the long-term bearer credential originate here and stay here. No descriptor, enrollment file or long fingerprint needs to be exchanged. Completion saves a private local pairing. Add `~/.local/bin` to PATH, or use `$HOME/.local/bin/holocron`.

```sh
holocron status
```

Repeating setup reuses a valid saved pairing. To renew an expired pairing, get a fresh Mac code and add `--renew` to the same receiver setup command. A replacement computer creates fresh credentials.

## Test the connection

Keep `holocron start` running on the Mac. For this harmless request, the owner enters `holocron-acceptance-2026` and chooses **Approve and send**. The receiver prints only PASS or FAIL and removes temporary files:

```sh
(
  set -eu
  set +x
  HC_TEST_DIR=$(holocron ask -m "Harmless receiver acceptance" TEST_API_KEY)
  trap 'holocron secrets cleanup --directory "$HC_TEST_DIR" >/dev/null' EXIT
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

Observe native Cancel and receiver Ctrl+C before real keys. [Device acceptance](secret-operations.md#acceptance-on-your-devices) also covers expiry, cleanup and revocation.

## Request keys for your task

Request one to eight uppercase names with a non-secret purpose. Saved pairing is selected automatically:

```sh
HC_SECRET_DIR=$(holocron ask -m "Run my approved task" OPENAI_API_KEY)
```

The command waits up to fifteen minutes from request creation for native approval and prints only the private directory path. The owner can type or use Cmd+V or **Edit > Paste** in masked native fields. Files are `0600` in a `0700` directory. Never display values with `cat`, read them through model-visible tools, substitute them into argv, enable tracing or log them.

The authorized program reads the files directly and sends values only to the intended provider. Suppress credentials and provider response bodies from output. Clean up even when the program fails:

```sh
holocron secrets cleanup --directory "$HC_SECRET_DIR"
```

An independent worker also removes files five minutes after receipt. This plaintext cleanup window is separate from the fifteen-minute approval deadline. Sleep, power loss or forced termination can delay deletion; cleanup is not a secure-erasure guarantee. Ctrl+C cancels pending requests. Pairing lasts seven days; requests approaching pairing expiry use the earlier deadline.

Existing `ask --pairing-file /absolute/private/receiver.json -m PURPOSE NAME` and the original fingerprint-authenticated `secrets prepare`, `pair`, `complete` workflow remain supported.

## Copyable agent task

```text
Set up Holocron from its public release:
curl -fsSL https://holocron.ashray.xyz/setup.sh | sh -s -- receiver --code MAC_PAIRING_CODE
Send me only the printed eight-digit verification number.
Keep receiver credentials local. Test a harmless value first.
For my approved task, use holocron ask -m "task purpose" KEY_NAME.
Read returned files only inside the program that needs them.
Never put values in chat, model tools, argv, URLs or logs.
Clean up the returned directory. Later requests reuse saved pairing.
```

Reference: [Node platform requirements](https://github.com/nodejs/node/blob/main/BUILDING.md#platform-list).
