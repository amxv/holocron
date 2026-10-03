# Shared Clipboard for Local and Cloud Computers

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
