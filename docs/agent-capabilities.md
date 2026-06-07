---
title: Agent Capabilities
---

# Agent capabilities

MiniOpenClaw's assistant can use a built-in set of tools while working in your workspace.

This page is a user-facing overview of what the assistant is able to do.

## File and text work

### Read files
The agent can read text files and supported image files from the workspace.

### Write files
The agent can create new text files or overwrite existing ones.

### Edit files
The agent can make targeted text replacements in files.

### Search files
The agent can:

- search file contents with `grep`
- find files by pattern with `glob`

## Shell commands

The agent can run bash commands in the workspace.

When sandboxing is enabled, these commands run inside the configured sandbox container by default.

Command output is truncated when it gets too large, with the full output saved separately when needed.

## Web access

The agent can use:

- web search
- web fetch

Use these when the task needs outside information instead of only local files.

## Background and automation tools

The agent can also manage:

- detached subagents
- scheduled cron jobs

See [Background tasks and scheduled jobs](automation.md).

## Image handling

The agent can inspect supported images saved in the workspace, including Telegram image attachments.

## Workspace boundary

The main file tools are designed around the configured workspace.

That keeps normal read, write, edit, search, and glob activity centered on your MiniOpenClaw working area.

## Related pages

- [Everyday usage](using-miniopenclaw.md)
- [Background tasks and scheduled jobs](automation.md)
- [Configuration](configuration.md)
