---
title: Changelog
description: Holocron releases, fixes, and upgrade notes.
order: 11
category: Reference
---

This page highlights changes in the published Holocron CLI and its accompanying documentation. See [installation and upgrades](operations.md#upgrades-and-install-recovery) for supported upgrade paths and the [GitHub releases](https://github.com/amxv/holocron/releases) for release assets and checksums.

## 0.3.5 — October 12, 2026

**Fixed release installation on macOS and Linux.** The macOS release packager no longer adds AppleDouble (`._package`) metadata outside the allowed `package/` directory. Release builds now verify archive member paths and types before generating checksums or publishing artifacts. The installer continues to reject unsafe archives, rather than weakening its checks.

- Added negative regression coverage for unsafe archive entries and types.
- Added this changelog to the documentation website and bundled CLI docs.
- No pairing protocol change. Existing credentials and saved pairings are retained during normal upgrades.

Install version `0.3.5` on the Mac and receiver. If updating an existing Mac setup, stop the operator before installation, run `holocron setup --rebuild-prompt`, then restart the service. For new pairings, generate a new code with `holocron pair`.

## 0.3.4 — October 10, 2026

Introduced **bidirectional encrypted text snippets** for paired devices, including `send`, `inbox`, `read`, `delete`, and `peers`. Paired receivers can expose the same operations with `holocron paired-mcp`. Snippets are end-to-end encrypted, capped at 16 KiB, and held for at most 24 hours. The relay was extended for directional messaging; clipboard behavior and secret approval remain unchanged.

## 0.3.3 — October 8, 2026

Added Raycast start/stop/status commands for the Mac service, a clearer status view distinguishing tunnel and secret-service health, and safer detached service controls.

## 0.3.2 — October 5, 2026

Extended pairing and key-approval windows to 15 minutes. Improved the native Mac prompt with masked typing, Cmd+V support, and Holocron icon; added a helper-rebuild upgrade path while preserving existing pairing state.

## 0.3.1 — October 4, 2026

Fixed Mac setup when a tunnel client is installed through a Homebrew executable alias. Tightened setup rollback and safe retries.

## 0.3.0 — October 4, 2026

Introduced automated Mac and Linux receiver setup, temporary code pairing with native verification, saved pairing, and owned lifecycle commands for the tunnel and secret services.
