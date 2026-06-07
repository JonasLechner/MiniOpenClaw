---
title: MiniOpenClaw Docs
---

# MiniOpenClaw

MiniOpenClaw is a long-running local assistant backend built around persistent sessions, a local workspace, and Telegram as the primary chat interface.

This documentation is user-facing. It explains how to install, operate, and use the system day to day.

## Documentation map

### Start here
- [Getting started](getting-started.md)
- [Configuration](configuration.md)
- [Everyday usage](using-miniopenclaw.md)

### Main features
- [Telegram](telegram.md)
- [Slash commands](slash-commands.md)
- [Background tasks and scheduled jobs](automation.md)
- [Agent capabilities](agent-capabilities.md)
- [Gateway HTTP API](gateway-api.md)

### Help
- [Troubleshooting](troubleshooting.md)

## What MiniOpenClaw gives you

- persistent local sessions
- a long-lived workspace the agent can use
- Telegram chat with per-chat session binding
- a local terminal UI for direct use
- detached background tasks
- scheduled cron-style jobs
- session compaction for long conversations
- optional sandboxing for shell commands
- local runtime state under `~/.mini-openclaw/`

## Important note

Memory is intentionally not documented here yet.
