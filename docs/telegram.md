---
title: Telegram
---

# Telegram

Telegram is the primary remote interface for MiniOpenClaw.

## What Telegram support does

When enabled with a bot token and polling, the gateway:

- registers Telegram bot commands on startup
- polls Telegram for new private messages
- binds each Telegram chat to a local session
- queues normal messages per chat so they run in order
- streams assistant replies back into Telegram
- supports slash commands
- supports detached background tasks
- supports scheduled jobs
- saves incoming images into the workspace
- can send referenced workspace images back to Telegram

## Private chats only

MiniOpenClaw currently handles **private chats** only.

Edited messages are ignored.

## Per-chat session binding

Each Telegram chat is bound to one session at a time.

That binding is stored locally so the chat can keep using the same ongoing session later.

Using `/new` creates a fresh session, rebinds the chat to it, and updates the main session agent binding.

## Access control

You can restrict which Telegram users may use the bot with:

- `gateway.telegram.allowedUserIds`

If that list is empty, any Telegram user who can reach the bot is allowed.

Rejected users receive `Unauthorized Telegram user.` and the event is logged.

## Message handling

Normal text messages are sent into the current bound session.

MiniOpenClaw queues normal messages per chat so prompts are processed in order. The `/stop`, `/bg`, and `/bgstop` commands bypass that queue: `/stop` can interrupt a running foreground task quickly, `/bg` can start detached work without waiting for the current foreground reply to finish, and `/bgstop` can stop background work immediately.

If the agent reports a compaction event during a run, Telegram receives a `Compacting...` status before streaming continues.

## Streaming replies

Assistant replies are streamed into Telegram as they are generated.

## Images in Telegram

If you send an image, MiniOpenClaw:

1. downloads it
2. saves it into the workspace under `telegram-attachments/<chat-id>/`
3. turns the message into a prompt that includes the saved path
4. tells the agent to use the read tool on that path

Supported image inputs include Telegram photos, live photo stills, image documents, image animations, and image-like video payloads when Telegram marks them with an image MIME type.

Supported file types include:

- JPG / JPEG
- PNG
- GIF
- WebP

## Sending images back

If the assistant reply references image paths inside the workspace, MiniOpenClaw can send those files back to Telegram as image attachments.

MiniOpenClaw sends up to five referenced workspace images from a final reply. Paths outside the workspace are ignored.

## Commands

Telegram supports:

- `/start` — show command help
- `/new` — create and bind a new session
- `/session` — show current session/model/run status
- `/bg <prompt>` — run detached background work
- `/bglist` — list background tasks for this session
- `/bgstop <taskId>` — stop a background task
- `/compact` — compact the current session
- `/stop` — request that the current foreground run stop

See [Slash commands](slash-commands.md).

## Related pages

- [Getting started](getting-started.md)
- [Background tasks and scheduled jobs](automation.md)
- [Slash commands](slash-commands.md)
