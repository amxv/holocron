# Holocron for Raycast

Share your copied Mac text or one selected Finder UTF-8 file with an explicit shortcut. Each invocation captures once. Sharing does not populate a remote clipboard or watch later copies.

The canonical [Raycast user guide](../docs/raycast.md) covers installation, hotkeys, preferences and migration from Board. Start there, or read it on the [Holocron site](https://holocron.ashray.xyz/docs/raycast).

## Develop

Use Node **24.21.0** and Bun **1.4.0**. Install/link the Holocron CLI first. From this folder:

```sh
bun install --frozen-lockfile
bun run lint
bun run build
bun run dev
```

Development mode imports the extension into Raycast. Stop it with Control-C after ready; the commands remain installed. No store publication is needed.

The clipboard command calls `holocron copy --name "Raycast clipboard"`; the Finder command calls `holocron share-file <selected-path> --name "Raycast file"`. Both use a literal argument list without a shell. Success requires a metadata-only JSON receipt. Feedback omits raw stdout/stderr and clipboard/file contents. A 10-second timeout may occur after storage, so list shares before retrying.

For scoped validation, build the root CLI first, then run:

```sh
bun run lint
bun run build
bun run test
```

Tests use temporary mock CLIs and isolated production-CLI state with an injected clipboard adapter. They do not read live clipboard, config or credentials. The extension retains its private manifest access and original license; source history is preserved in its original repository.
