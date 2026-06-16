---
title: Tool Reference
---

# Tool reference

This page summarizes the built-in tools the assistant can use.

## Workspace file tools

These operate inside the configured workspace:

- `read` — read text files and supported images.
- `write` — write text to a file.
- `edit` — replace a line range or targeted text in a file.
- `grep` — search lines in a file.
- `glob` — find files by pattern.
- `workspace_search` — search the workspace recursively using the local full-text index.

The exact tool behavior depends on the active interface and model adapter, but the workspace boundary is the main safety rule.

## Shell

- `bash` — execute a shell command in the workspace.

When sandboxing is enabled, `bash` runs through the configured sandbox. Output is truncated when large; MiniOpenClaw preserves enough detail for the agent to continue or report that output was truncated.

## Web

- `web_search` — search the web.
- `web_fetch` — fetch/extract a web page.

These require configured provider/tool support and may be unavailable in restricted environments.

## Automation

- `subagent` — start, inspect, or manage detached background work.
- `cronjob` — create and manage scheduled jobs.

Use these for work that should not block the current foreground turn or should happen on a schedule.

## Safety notes

- Prefer workspace file tools for normal file work.
- Treat `workspace/miniopenclaw-docs/` as read-only reference docs.
- Do not read or edit MiniOpenClaw's own `~/.mini-openclaw/config.json` or `~/.mini-openclaw/auth.json`; these are user-managed safety/credential files.
- Ask before destructive, broad, or surprising changes.
- Sandbox configuration affects shell commands, not the user's intent or approval requirements.

## Related pages

- [Agent capabilities](agent-capabilities.md)
- [Sandbox](sandbox.md)
- [Background tasks and scheduled jobs](automation.md)
