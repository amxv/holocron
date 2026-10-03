# Shared Clipboard for Local and Cloud Computers

## Current implementation
Phase 1 local preparation only. The TypeScript MCP service authenticates a single configured owner and exposes `get_bridge_status` and `read_synthetic_probe`, which return synthetic status and one fixed harmless marker. It cannot access personal files, clipboards, shell commands, or arbitrary URLs.

The private plugin scaffold has an empty registered-connection mapping. No identity provider, OAuth callback/resource settings, tunnel, intended dot, or viewed cloud clipboard session has been verified. Phase 1 is incomplete until the live gates pass. Later clipboard and selected-file features remain proposed.

Use Node `24.21.0` and npm `11.19.0`. Run `npm ci`, then `npm run check`. See [Phase 1 setup and live evidence gates](docs/phase1-setup.md) for configuration, tunnel/plugin registration, and the required actual Dots and desktop tests. Local synthetic authentication tests do not prove live compatibility.

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
