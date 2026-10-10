---
title: How Holocron works
description: Selected context through MCP, and approved encrypted keys to a paired receiver.
order: 2
category: Start
---

Holocron connects your Mac to an agent on another computer. You share the text and files you select. When that agent needs API keys, it asks and you approve a native Mac prompt.

[Install Holocron](getting-started.md), then choose the connection your task needs.

## Context you select

`holocron copy` captures your Mac text clipboard once. `holocron share-file` captures one selected UTF-8 file. A connected agent reads the frozen snapshot through your private MCP tunnel. Later changes to your clipboard or source file are not shared.

Use a [Raycast shortcut](raycast.md) for the same explicit action. Shares expire after 24 hours; you can revoke them sooner. Text is limited to 256 KiB, files to 10 MiB, and total snapshots to 100 MiB.

Sharing does not populate another computer's clipboard. [Remote Paste](cloud-clipboard.md) needs a separately authorized receiving operation in a supported Linux Wayland session. A connected agent can also copy a requested literal reply to your Mac; you paste it yourself.

## Keys you approve

The [receiving computer](secret-requests.md) generates its own credentials. You exchange a public descriptor and encrypted enrollment, compare fingerprints and approve pairing on the Mac. Its agent then runs `holocron ask` with key names and a non-secret purpose.

You review the recipient and request in the native Mac prompt, enter values and choose **Approve and send**. Encrypted delivery creates short-lived private files on the receiver. Its authorized program reads them directly; key values stay out of chat, MCP results and clipboard snapshots.

The [Mac secret service](secret-operations.md) is separate from the context companion. API keys do not need an MCP tunnel; context sharing does not grant secret delivery.

## What runs where

| Component | Location | Purpose |
| --- | --- | --- |
| Context companion + private MCP tunnel | Your Mac | Serve your selected snapshots and requested Mac clipboard writes |
| Paired secret service + native prompt | Your awake Mac | Review pairing and approve individual key requests |
| Receiving CLI | Agent's macOS or Linux computer | Create receiver credentials and deliver approved keys as private files |
| Hosted site + secret relay | Holocron's domain | Serve docs/installer and relay public metadata and encrypted key deliveries |
| Optional clipboard helper | Agent's Linux Wayland session | Explicit clipboard reads or writes for that graphical session |

## Your control and its limits

There is no clipboard watcher, automatic paste, command execution or remote live Mac clipboard access. Files are selected snapshots, not ongoing filesystem grants or native attachments.

Context snapshots are private local **plaintext**. Approved keys exist in private receiver files and endpoint memory. Protect both OS accounts. Revocation prevents future access but cannot erase copies already received. Interrupted clipboard writes are not replayed automatically.

The 0.3.4 workflow supports automated setup, temporary code pairing and saved daily controls, with fifteen-minute pairing/key approval deadlines and masked native typing or paste. It is distributed through the public GitHub release and uses the existing relay. Earlier synthetic relay acceptance does not establish real device/native GUI behavior or remote discovery. [Test a harmless key](secret-requests.md#test-the-connection) before real values.
