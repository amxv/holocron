# Holocron for Raycast

Press a Raycast shortcut to explicitly share your current Mac text clipboard with Holocron for ChatGPT. Each invocation captures once. Nothing runs in the background or watches the clipboard.

**Sharing with Holocron does not populate a remote computer's clipboard.** ChatGPT can retrieve the shared item through the Holocron connection. Pasting into a remote application requires a separate receiving operation. The extension never claims a share is ready for remote Paste.

## Install

You need macOS, Raycast, Node.js 24.21.0 or newer, Bun 1.4.0, and the Holocron CLI. Install and link the CLI using the Holocron project's installer first. The extension expects `~/.local/bin/holocron` by default, which must be an executable installed by Holocron. It does not download a CLI, start a server, or configure a tunnel.

Clone the canonical private monorepo using your existing GitHub access:

```sh
git clone https://github.com/amxv/holocron.git
cd holocron/raycast
bun install --frozen-lockfile
bun run lint
bun run build
bun run dev
```

`bun run dev` imports the extension into Raycast. When it reports the extension is ready, press Control-C to stop development mode. The commands remain installed. Run `bun run dev` again after updating the source. You can also run Raycast's **Import Extension** command and select the monorepo's `raycast/` folder, then run `bun run dev` from that folder.

This is a local installation. The manifest declares the existing `zue-ai` owner and private access, but installing locally requires no store publication.

## Assign a shortcut

1. Open Raycast Settings → Extensions → Holocron.
2. Select **Share Clipboard with Holocron**.
3. Click its Hotkey field and press the shortcut you want. Choose an unused shortcut.
4. Copy text in any Mac app, then press the shortcut. Raycast shows a success message with the shared byte count and 24-hour expiry, or an actionable error.

Searching Raycast for **Share Clipboard with Holocron** performs the same explicit action. The extension does not assign or change any hotkeys automatically.

For files, select exactly one UTF-8 file in Finder, keep Finder as the active app, then run **Share Selected Finder File with Holocron**. You may assign a separate shortcut to this command. Holocron accepts files up to 10 MiB; folders, binary files and multiple selections are unsupported. This command shares the selected file directly, without changing the Mac clipboard. Clipboard sharing accepts text up to 256 KiB, including an empty snapshot. Images and Finder file copies are not captured by the text clipboard command.

## Preferences

- **Holocron CLI Executable:** Leave blank for the absolute path derived from your home directory, `~/.local/bin/holocron`. For a custom installation, enter its full absolute executable path. Do not enter `~`, command arguments or a shell command.
- **Local Holocron Config:** Leave blank to use the CLI's existing private config reference. If needed, enter an absolute path to the local Holocron JSON config. The extension passes this path to the CLI without reading the config. Do not enter a token or URL.

Configure Holocron with `holocron link --local-config /absolute/path/to/holocron-local.json` before using the shortcut. Holocron owns its credentials and local config. A Raycast launch does not rely on your interactive shell's PATH. The installed CLI launcher must already point to its required Node runtime.

## Feedback and limits

The shortcut calls `holocron copy --name "Raycast clipboard"` once; the Finder command calls `holocron share-file <selected-path> --name "Raycast file"`. Both append `--local-config <absolute-path>` only when that preference is set. Execution uses a fixed argument list without a shell. Clipboard contents are never treated as commands, inserted into process arguments, displayed in feedback, or logged.

Success requires a valid metadata-only JSON receipt from Holocron. The HUD says **Shared text with Holocron** or **Shared file with Holocron**, with size and expiry. A missing CLI or invalid path points you to extension preferences. For other failures, run `holocron status` in Terminal to check the CLI's configured connection. Failure feedback omits raw CLI stdout, stderr and process error messages to keep private content out of Raycast notifications.

A share times out after 10 seconds. A timeout or invalid receipt can occur after Holocron stored an item; check Holocron before retrying. There is no automatic retry, clipboard watcher, menu bar command, receiving helper, or remote Paste action. Development mode's source rebuild process stops when you press Control-C.

## Development checks

```sh
bun install --frozen-lockfile
bun run lint
bun run build
bun run test
```

## Migrate the existing local import

Record the old Board extension preferences and bindings first. The verified clipboard hotkey was **Control+Option+Command+C**; the Finder command had no recorded hotkey. Clear/disable the old clipboard binding before importing `raycast/` from this monorepo. After `bun run dev` reports ready, stop it with Control-C, select **Holocron → Share Clipboard with Holocron** in Raycast Settings and assign Control+Option+Command+C. Check for duplicate old/new bindings. Disable/remove the old Board import once the new commands work. Raycast identifies the renamed extension separately, so preferences and hotkeys need explicit migration.

Leave the executable preference blank for `~/.local/bin/holocron`, or set its actual custom absolute path. Re-enter the old absolute local config preference only if one was set; blank uses Holocron's saved profile, including its existing Board profile fallback. Import and assigning hotkeys do not require reading the current clipboard. Test only after deliberately copying a harmless marker. Keep the old standalone checkout available until the monorepo import is verified.

Source provenance: imported from private `amxv/holocron-raycast` (formerly `amxv/board-raycast`) main commit `16bb04bdcbb19181cf33f22bc3ac2d0e6e689d42`. Its original repository retains source history. This folder contains maintained extension source and its existing PNG icon, with no nested Git repository or gitlink. CLI changes and extension contract tests now ship together in `amxv/holocron`. The manifest retains `owner: zue-ai`, `access: private` and the MIT license. No npm or Raycast store publication is performed by local development.

Tests execute temporary mock CLI programs, use metadata fixtures and exercise the monorepo's built production CLI with isolated state and an injected clipboard adapter. Build the root CLI first (`bun run build` from the monorepo root), or run the complete root `bun run check` after `bun run ci:all`. They cover literal arguments, schema validation, file selection, process errors, timeout, and feedback without reading the user's clipboard, credentials, config, or live Holocron state.

Official references: [manifest](https://developers.raycast.com/information/manifest), [CLI and local development](https://developers.raycast.com/information/developer-tools/cli), [creating and installing a local extension](https://developers.raycast.com/basics/create-your-first-extension), and [Finder selection](https://developers.raycast.com/api-reference/environment).
