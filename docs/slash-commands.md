---
title: Slash Commands
---

# Slash commands

## Telegram commands

### `/start`
Shows the available Telegram commands.

### `/new`
Starts a new session and binds the current Telegram chat to it.

### `/session`
Shows:

- current session id
- active model
- active run id, if any
- when the active run started, if any

### `/bg <prompt>`
Runs a prompt as a detached background task.

Use this for work that may take a while. When the task finishes, MiniOpenClaw sends the result back to Telegram and adds it into the current session.

### `/bglist`
Lists background tasks for the current session.

### `/bgstop <taskId>`
Stops a queued or running background task for the current session.

### `/compact`
Compacts the current session.

This reduces the effective size of long session history while keeping the session usable.

### `/stop`
Requests that the current foreground run stop.

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
- Scheduled jobs are currently managed through the agent's `cronjob` capability, not a Telegram slash command.
- The local agent UI and Telegram are designed to work with the same long-lived system.

## Related pages

- [Telegram](telegram.md)
- [Background tasks and scheduled jobs](automation.md)
- [Using MiniOpenClaw](using-miniopenclaw.md)
- [Getting started](getting-started.md)
