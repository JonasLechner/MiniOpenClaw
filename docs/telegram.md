---
title: Telegram
---

# Telegram

Telegram is the primary remote interface for MiniOpenClaw.

## What Telegram support does

When enabled, the gateway:

- polls Telegram for new private messages
- binds each Telegram chat to a local session
- streams assistant replies back into Telegram
- supports slash commands
- supports detached background tasks
- supports scheduled jobs
- saves incoming images into the workspace

## Private chats only

MiniOpenClaw currently handles **private chats**.

## Per-chat session binding

Each Telegram chat is bound to one session at a time.

That binding is stored locally so the chat can keep using the same ongoing session later.

Using `/new` creates a fresh session and rebinds the chat to it.

## Access control

You can restrict which Telegram users may use the bot with:

- `gateway.telegram.allowedUserIds`

If that list is empty, any Telegram user who can reach the bot is allowed.

## Message handling

Normal text messages are sent into the current bound session.

MiniOpenClaw also queues messages per chat so prompts are processed in order. The `/stop` command is allowed to bypass that queue so you can interrupt a running task quickly.

## Streaming replies

Assistant replies are streamed into Telegram as they are generated.

## Images in Telegram

If you send an image, MiniOpenClaw:

1. downloads it
2. saves it into the workspace under `telegram-attachments/`
3. tells the agent where the file was saved
4. lets the agent inspect it from the workspace

Supported image types include:

- JPG / JPEG
- PNG
- GIF
- WebP

## Sending images back

If the assistant reply references image paths inside the workspace, MiniOpenClaw can send those files back to Telegram as image attachments.

## Commands

See [Slash commands](slash-commands.md).

## Related pages

- [Getting started](getting-started.md)
- [Background tasks and scheduled jobs](automation.md)
- [Slash commands](slash-commands.md)
