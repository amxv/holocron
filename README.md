# Holocron

Share selected context with an agent on another computer, and privately provide the API keys it asks for. You choose the clipboard text or UTF-8 file. You approve each key request in a native Mac prompt.

Paired devices can also send short encrypted text snippets **in either direction** without re-pairing. Once both clients and the relay are upgraded:

```sh
printf 'Hello from my Mac\n' | holocron send --name "Quick note"
holocron inbox
holocron read MESSAGE_ID
```

On a Mac with multiple paired receivers, select one with `holocron peers` and `--peer PEER_ID`. On the receiver, launch `holocron paired-mcp` to make the same operations available to an agent. The Mac STDIO MCP connection exposes the paired tools after restarting with matching saved setup. Messages are end-to-end encrypted, at most 16 KiB and retained for no longer than 24 hours. Neither clipboard is changed. See [paired text](docs/paired-text.md).

[Set up Holocron](https://holocron.ashray.xyz/docs/getting-started) or use the offline [getting-started guide](docs/getting-started.md). Setup installs missing pinned Node locally and downloads the public `amxv/holocron` GitHub release anonymously. The 0.3.4 workflow uses the published release and existing relay; earlier published releases stay immutable.

Set up the Mac once, then use `holocron pair`, `holocron start`, `holocron status` and `holocron stop`. The receiver installs and pairs with one command:

```sh
curl -fsSL https://holocron.ashray.xyz/setup.sh | sh -s -- receiver --code MAC_PAIRING_CODE
```

Give the printed eight-digit verification number to the Mac owner for native approval. Later, `holocron ask -m "Run my approved task" OPENAI_API_KEY` uses saved pairing. [Mac setup and tunnel references](docs/secret-operations.md) cover the one-time configuration and necessary device login.

| Task | Guide |
| --- | --- |
| Authenticate/pair a receiving agent and request keys | [Private API key requests](docs/secret-requests.md) |
| Approve pairing and run the Mac secret service | [Mac pairing and service](docs/secret-operations.md) |
| Share copied text or selected files through MCP | [Text](docs/text-bridge.md) · [Context files](docs/context-files.md) |
| Exchange text via CLI or MCP between paired devices | [Paired text](docs/paired-text.md) |
| Share and control the Mac service from Raycast | [Raycast](docs/raycast.md) |
| Connect the Mac's private MCP endpoint | [Secure MCP Tunnel](docs/secure-mcp-tunnel.md) |
| Deliberately fill a remote Wayland clipboard | [Clipboard helper](docs/cloud-clipboard.md) |

`holocron copy` shares one immutable snapshot; it does not fill another computer's clipboard. There is no clipboard watcher or automatic paste. Private key requests require paired endpoints and native approval; values are delivered as short-lived private receiver files, outside chat, MCP results and ordinary snapshots.

Keep the Mac awake and the relevant service running. Context snapshots are private local plaintext. Revocation prevents future access but cannot erase copies already received. Protect the endpoint OS accounts and keep credentials out of chat, arguments and logs.

A production synthetic ciphertext/consume/replay/revoke probe passed. Actual intended receiver/native GUI acceptance and viewed Mac/cloud clipboard compatibility remain **deferred and unverified**. Test harmless values on your devices before real keys. [Commands and limits](docs/reference.md), [troubleshooting](docs/troubleshooting.md) and [operations](docs/operations.md) cover the details.

## Develop

Source tooling uses **Bun 1.4.0**; installed CLI processes use **Node 24.21.0**. Each project has an independent frozen Bun lockfile. npm-format locks remain for audit compatibility.

```sh
bun run ci:all
HOLOCRON_TEST_REDIS_SERVER=/absolute/test/redis-server bun run check
bun audit
git diff --check
```

Root `check` covers CLI/security/package/installer checks, Raycast checks and Astro diagnostics. Scoped gates are `check:cli`, `check:raycast` and `check:site`; the site gate runs **Astro check only**. Build the root CLI before Raycast integration tests. Isolated fixtures use injected clipboard adapters and do not access live config, keys, clipboards or tunnel credentials.

The monorepo contains CLI code in `src/`, canonical guides in `docs/`, the Astro/ZueDocs website in `site/` and the extension in `raycast/`. The npm manifest remains `private: true` to prevent accidental registry publication; public GitHub release bundles ship built code, canonical docs, native prompt source and an unmapped plugin scaffold. See [site development](site/README.md) and [Raycast development](raycast/README.md) for their local workflows. The known site audit baseline GHSA-ch52-4w7c-c8xp remains separate and unsuppressed.

## License

Holocron is licensed under the Apache License 2.0. See [LICENSE](LICENSE).
