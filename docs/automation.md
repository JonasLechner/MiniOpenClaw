---
title: Background Tasks and Scheduled Jobs
---

# Background tasks and scheduled jobs

MiniOpenClaw supports several related forms of detached work:

- **background tasks** — start now, finish later
- **subagents** — internal detached assistant runs launched by the agent
- **scheduled jobs** — run automatically on a cron schedule

## Background tasks

Background tasks are detached assistant runs.

They are useful for:

- long-running work
- research or batch-style tasks
- jobs you want to let continue while you do something else

### How they work

A background task:

1. starts from the current Telegram-bound session
2. runs in a detached session
3. can reuse the main session sandbox
4. sends its result back to Telegram when finished
5. adds a summary of that result back into the main session

### Telegram commands

- `/bg <prompt>` — start a background task
- `/bglist` — list tasks for the current session
- `/bgstop <taskId>` — stop a task

### Statuses

A background task may be:

- `queued`
- `running`
- `completed`
- `failed`
- `aborted`

Completed and failed tasks are kept around for a while so you can still inspect recent results.

## Subagents

MiniOpenClaw also exposes background work as an internal `subagent` capability.

In practice, this is the same detached-work idea: a secondary assistant run can be launched, listed, and stopped for the current Telegram-bound session.

Use the term **background task** for user-visible Telegram `/bg` work, and **subagent** for detached work started by the assistant through its tool set.

## Scheduled jobs

MiniOpenClaw can run scheduled jobs on a cron-style schedule.

These jobs are checked by the gateway roughly once per minute.

### What scheduled jobs can do

A scheduled job can either:

- send a plain notification into Telegram
- run a prompt automatically

### Prompt targets

Scheduled prompt jobs can target either:

- **main-session** — run directly in the currently bound session
- **detached** — run in a detached session, then send the result back and add it into the main session

### How scheduled jobs are created

Scheduled jobs are currently created through the agent's `cronjob` capability rather than a Telegram slash command.

Supported actions:

- list jobs
- create a job
- enable a job
- disable a job

### Cron format

MiniOpenClaw uses standard 5-field cron expressions:

```text
minute hour day-of-month month day-of-week
```

Examples:

```text
0 9 * * *
*/15 * * * *
30 18 * * 1-5
```

### Storage

Scheduled jobs are stored in:

```text
~/.mini-openclaw/scheduled-tasks.json
```

## What to use when

### Use a background task when

- you want it to start immediately
- it may take a while
- you still want the result added back into the conversation later

### Use a scheduled job when

- you want repeated automation
- you want timed reminders or recurring prompts
- you want the system to trigger work without manually starting it

## Related pages

- [Telegram](telegram.md)
- [Slash commands](slash-commands.md)
- [Tool reference](tool-reference.md)
- [Sessions and compaction](sessions.md)
- [Everyday usage](using-miniopenclaw.md)
