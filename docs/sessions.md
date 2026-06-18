---
title: Sessions and Compaction
---

# Sessions and compaction

MiniOpenClaw is session-based. A session is the durable conversation state used by the agent loop.

## Session logs

Session history is stored under:

```text
~/.mini-openclaw/sessions/
```

Sessions are append-only JSONL logs. They record typed events such as user messages, assistant messages, tool activity, errors, and compaction summaries.

This makes sessions resumable across process restarts and inspectable with normal file tools.

## Current sessions

MiniOpenClaw tracks current session pointers separately from the session logs.

The TUI and gateway can continue their own current sessions; the dashboard/API displays the gateway current session. Telegram chats are bound through `conversation-bindings.json` and do not read `current-sessions.json.gateway` after a chat binding exists.

Useful distinction:

- **session** — the durable conversation log;
- **current session** — the session a local interface will continue by default;
- **bound session** — the session associated with a Telegram chat;
- **run** — one active attempt to answer a prompt inside a session.

## Telegram binding

Each Telegram private chat can be bound to a session.

- `/new` creates a new session and binds the chat to it.
- `/session` reports the bound session and active run state.
- Detached background work can report back into the same bound session.

## Compaction

Long sessions can be compacted.

Compaction summarizes older history into a continuation-focused summary while preserving the current working thread. This keeps long-running conversations usable without deleting the session log.

You can request compaction with:

```text
/compact
```

## Stopping a run

`/stop` requests cancellation of the current foreground run. A stopped run may leave partial assistant output in the session, depending on where cancellation happened.

## Related pages

- [Everyday usage](using-miniopenclaw.md)
- [Telegram](telegram.md)
- [Slash commands](slash-commands.md)
- [Runtime layout](runtime-layout.md)
