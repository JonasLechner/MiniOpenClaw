---
title: Everyday Usage
---

# Everyday usage

## The two main processes

MiniOpenClaw is usually run as two cooperating processes:

- **gateway** — the always-on backend service
- **agent UI** — the local interactive terminal interface

If Telegram is enabled, the gateway also polls Telegram and handles incoming messages there.

## Sessions

MiniOpenClaw is built around persistent sessions.

A session stores conversation history locally and remains available across restarts.

Common session actions:

- continue using the current session
- start a new one with `/new`
- inspect the current one with `/session`
- compact a long one with `/compact`

## Shared session behavior

Telegram chats are bound to a session.

That means a Telegram chat can keep returning to the same conversation state over time. Detached work can also add its result back into that same session.

## Long conversations and compaction

MiniOpenClaw can compact long sessions.

Compaction keeps the session usable by summarizing older context while preserving the active working thread. You can also trigger it manually with `/compact` in Telegram.

## Runtime home

MiniOpenClaw stores runtime state under:

```text
~/.mini-openclaw/
```

Important paths:

- `config.json` — main config
- `auth.json` — saved provider credentials
- `sessions/` — append-only session logs
- `workspace/` — working directory for the agent
- `conversation-bindings.json` — Telegram chat to session mapping
- `scheduled-tasks.json` — scheduled job definitions

## Workspace

Default workspace:

```text
~/.mini-openclaw/workspace/
```

This is where the agent reads and writes files. Telegram image attachments are also saved here.

You can change the workspace location with `workspacePath` in config.

## Telegram attachments

When you send an image in Telegram private chat, MiniOpenClaw saves it into the workspace and lets the agent inspect it from there.

It can also send workspace image files back to Telegram when the assistant references them in its reply.

## Sandbox

When sandboxing is enabled, shell commands run in a container by default.

Default image:

```text
miniopenclaw-sandbox:local
```

The sandbox is session-scoped, so a session can keep reusing its environment across resumed work.

## Logging

MiniOpenClaw supports configurable log levels:

- `debug`
- `info`
- `warn`
- `error`

See [Configuration](configuration.md).

## Related pages

- [Telegram](telegram.md)
- [Background tasks and scheduled jobs](automation.md)
- [Agent capabilities](agent-capabilities.md)
