---
title: Runtime Layout
---

# Runtime layout

MiniOpenClaw keeps its mutable state in a runtime home and gives the agent a separate workspace for day-to-day file work.

## Runtime home

Default runtime home:

```text
~/.mini-openclaw/
```

Important files and directories:

- `config.json` — main runtime configuration; user-managed and not for the agent to read or edit.
- `auth.json` — saved provider credentials and tokens; user-managed and not for the agent to read or edit.
- `sessions/` — append-only JSONL session logs.
- `current-sessions.json` — current session pointers for local interfaces (`tui` and `gateway`). The dashboard/API displays the gateway current session. These are not Telegram chat bindings.
- `conversation-bindings.json` — Telegram chat to session bindings. Once a Telegram chat has a binding, Telegram continues that bound session rather than reading `current-sessions.json.gateway`.
- `scheduled-tasks.json` — scheduled job definitions.
- `gateway.pid` — process id for the managed background gateway service.
- `gateway.log` — JSONL gateway/runtime log output when `logging.file` is enabled; also stdout for the managed background gateway service.
- `gateway.err.log` — stderr from the managed background gateway service.
- `workspace/` — default workspace exposed to the agent.

## Workspace

Default workspace:

```text
~/.mini-openclaw/workspace/
```

The workspace is the agent's normal working directory. Workspace-bounded tools read, write, edit, search, and glob inside this tree.

Common workspace paths:

- `user.md` — durable user preferences and stable personal context maintained by onboarding/profile setup and injected into the agent system prompt.
- `context.md` — durable project/workspace context and conventions.
- `memory/` — human-readable memory and reflection material.
- `skills/` — workspace skills loaded into the agent prompt.
- `telegram-attachments/` — files received from Telegram.
- `miniopenclaw-docs/` — generated read-only MiniOpenClaw documentation snapshot for sandboxed agents.
- `workspace-search.sqlite` — local search index database.

## Generated docs snapshot

On startup, MiniOpenClaw refreshes:

```text
workspace/miniopenclaw-docs/
```

This directory is intended for agents that can only see the workspace, including sandboxed agents whose shell runs in `/workspace`.

It is managed by MiniOpenClaw. Do not store personal files there; it may be deleted and recreated on startup.

## Source of truth

For normal use:

- edit runtime context in `workspace/user.md` or `workspace/context.md` when appropriate; `user.md` is the single durable user-context file and is injected into the agent prompt;
- edit skills under `workspace/skills/`;
- treat `workspace/miniopenclaw-docs/` as read-only generated reference material;
- keep `~/.mini-openclaw/config.json` and `~/.mini-openclaw/auth.json` user-managed. The agent should not read or edit them.

## Related pages

- [Sessions and compaction](sessions.md)
- [Sandbox](sandbox.md)
- [Skills](skills.md)
- [Configuration](configuration.md)
