---
title: Slash Commands
---

# Slash commands

## Telegram commands

### `/start`
Shows the available Telegram commands. MiniOpenClaw also tries to register these bot commands with Telegram on gateway startup.

### `/new`
Starts a new session, binds the current Telegram chat to it, and makes the main session agent use that session.

### `/session`
Shows:

- current session id
- active provider/model
- active run id, if any
- when the active run started, if any

### `/bg <prompt>`
Runs a prompt as a detached background task.

Use this for work that may take a while. When the task finishes, MiniOpenClaw sends the result back to Telegram and adds it into the current session.

### `/bglist`
Lists background tasks for the current session.

### `/bgstop <taskId>`
Stops a queued or running background task for the current session.

Without a task id, MiniOpenClaw replies with usage text.

### `/compact`
Compacts the current session.

This reduces the effective size of long session history while keeping the session usable. Telegram first sends `Compacting...`, then reports whether compaction happened, was skipped, or was unnecessary.

### `/stop`
Requests that the current foreground run stop.

If no foreground run is active, MiniOpenClaw replies `No active run to stop.` This command bypasses the per-chat message queue.

## Agent skill invocation

### `/skill:<name> [arguments]`
Invokes a workspace skill by name.

Skills live under `workspace/skills/` and are described by `SKILL.md` files. This is handled as an agent prompt pattern after Telegram command handling; it is not registered as a Telegram bot command. See [Skills](skills.md).

## Local agent UI commands

These commands are available in the terminal UI.

### `/new`
Starts a new local session.

### `/clear`
Clears the visible chat pane in the UI.

This does not delete session history.

### `/quit`
Exits the UI.

### `/exit`
Exits the UI.

## Notes

- Normal messages do not need a slash command.
- Telegram commands are transport-specific.
- `/skill:<name>` is an agent prompt pattern, not a Telegram bot management command.
- Scheduled jobs are currently managed through the agent's `cronjob` capability, not a Telegram slash command.
- The local agent UI and Telegram are designed to work with the same long-lived system.

## Related pages

- [Telegram](telegram.md)
- [Skills](skills.md)
- [Background tasks and scheduled jobs](automation.md)
- [Using MiniOpenClaw](using-miniopenclaw.md)
- [Getting started](getting-started.md)
