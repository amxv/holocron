# Holocron for Raycast

Share your copied Mac text or one selected Finder UTF-8 file with an explicit shortcut, and start, stop or inspect the Mac secret-request service from Raycast. Sharing captures once; it does not populate a remote clipboard or watch later copies.

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

**Start Holocron Service** launches bare `holocron start` as a detached process with ignored stdio, then confirms a stable running state via `holocron status`. **Stop Holocron Service** uses bare `holocron stop` and validates its acknowledgement. **Holocron Service Status** shows operator, tunnel and secret backend health, with Start/Stop/Refresh actions. It only displays recognized health fields, never receiver identifiers, raw CLI output or private paths. Service commands do not use the share-only `--local-config` preference, which changes CLI routing to the legacy companion. They require a saved Mac setup; they do not pair devices, auto-recover a stale socket or enable login startup. Native secret approvals remain necessary.

For scoped validation, build the root CLI first, then run:

```sh
bun run lint
bun run build
bun run test
```

Tests use temporary mock CLIs and isolated production-CLI state with an injected clipboard adapter. Service lifecycle tests use a private mock detached operator, not the live Holocron supervisor. They do not read live clipboard, config or credentials. The extension retains its private Raycast manifest access. Holocron is Apache-2.0 licensed; the Raycast extension is additionally available under MIT to satisfy Raycast's manifest validation.
