# Shared Clipboard for Local and Cloud Computers

## Current implementation
The TypeScript Mac companion now supports explicit clipboard capture or UTF-8 stdin sharing, immutable text snapshots, bounded MCP list/read, and literal Mac clipboard writes with durable retry receipts. A local CLI manages shares and starts/stops the foreground service. There is no clipboard watcher, automatic paste, command execution, remote clipboard read, or arbitrary filesystem access.

The private plugin scaffold still has an empty registered-connection mapping. Actual OAuth provider/callback/resource compatibility, tunnel forwarding, intended Dots installation/calls, real Mac editor paste, and viewed cloud clipboard tests are **deferred and unverified** by the user's instruction. Local tests use injected clipboard adapters and establish no live compatibility. Selected-file sharing and the cloud helper are later phases.

Use Node `24.21.0` and npm `11.19.0`. Run `npm ci`, then `npm run check`. See [Text bridge usage](docs/text-bridge.md) for local commands, limits and retry behavior, and [Connection setup](docs/phase1-setup.md) for the existing configurable provider/tunnel/plugin boundary and deferred live installation checks.

## Idea
A lightweight companion app installed on both my local computer and my AI assistant’s cloud computer, providing a shared clipboard between their operating systems.

## Primary Use Case
Copy a command on my Mac, transfer it to the cloud computer, and paste it into its terminal without retyping it or relying on clipboard support in the remote desktop viewer.

Support transferring text back from the cloud computer to my Mac too.

## Suggested MVP
- Local macOS app and cloud Linux app
- Secure pairing between the two installations
- Explicit action to send clipboard text in either direction
- Received text available to paste into any application
- Plain-text support first
- Connection status and easy disconnect
- Automatic expiry of transferred text

## Safety Defaults
- Never automatically execute commands
- Start with manual sharing rather than syncing every clipboard change
- Encrypt transfers and authenticate paired devices
- Avoid logging clipboard contents
- Provide a way to clear shared content

## Open Questions
- Direct connection or encrypted relay?
- Menu-bar app, keyboard shortcut, CLI, or a combination?
- Should optional automatic sync be added later?
- How should pairing survive cloud-computer restarts or replacement?
