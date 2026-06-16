---
title: Sandbox
---

# Sandbox

MiniOpenClaw can run shell commands through a sandbox instead of directly on the host.

The sandbox mainly affects the `bash` tool. Workspace file tools are still workspace-bounded by MiniOpenClaw itself.

## Modes

Sandboxing is controlled by `sandbox.enabled` in `config.json`.

- `false` — bash commands run on the host in the workspace directory.
- `true` — bash commands run through the configured sandbox engine.

The default sandbox engine is container-based.

## Workspace mount

Container sandboxes mount the configured workspace at:

```text
/workspace
```

So a sandboxed agent may see only `/workspace`, even though the host path is something like:

```text
~/.mini-openclaw/workspace
```

This is why MiniOpenClaw copies reference docs into `workspace/miniopenclaw-docs/` on startup.

## Reuse

Sandboxes are designed to be reused for the same workspace. This lets command-side state intentionally outlive a single CLI process or foreground run.

Do not assume a fresh container for every prompt.

## Image

Default image:

```text
miniopenclaw-sandbox:local
```

MiniOpenClaw can build/use its default local sandbox image depending on the configured engine and image settings.

## Limits and network

Sandbox configuration can control:

- network access;
- memory limit;
- CPU limit;
- process limit;
- image name;
- engine selection.

See [Configuration](configuration.md) for the exact keys.

## Important boundaries

Sandboxing is a safety layer, not a full security guarantee. MiniOpenClaw's own `config.json` and `auth.json` remain user-managed files; the agent should not read or edit them, especially because `config.json` controls sandbox settings.

In particular:

- the workspace is intentionally mounted into the sandbox;
- files written under `/workspace` affect the real configured workspace;
- long-lived/reused sandboxes may retain process or filesystem state allowed by the engine;
- network behavior depends on config.

## Related pages

- [Configuration](configuration.md)
- [Runtime layout](runtime-layout.md)
- [Agent capabilities](agent-capabilities.md)
