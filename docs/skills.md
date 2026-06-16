---
title: Skills
---

# Skills

Skills are reusable agent workflows stored inside the workspace.

They are intended for procedures the assistant should follow consistently, such as a house style, a repeated project workflow, or a domain-specific checklist.

## Location

Workspace skills live under:

```text
~/.mini-openclaw/workspace/skills/
```

A skill is a directory containing a `SKILL.md` file:

```text
skills/
  my-skill/
    SKILL.md
```

## Discovery

MiniOpenClaw discovers workspace skills on startup/prompt construction by reading `SKILL.md` files under `workspace/skills/`.

Skill names and descriptions are included in the agent's system context so the agent can choose relevant workflows.

## Explicit invocation

You can explicitly invoke a skill with:

```text
/skill:<name> optional arguments
```

Example:

```text
/skill:write-release-notes summarize the last milestone
```

If the named skill does not exist, MiniOpenClaw reports an error instead of guessing.

## `SKILL.md` format

A skill should be self-contained and concise. Use frontmatter for the name and description:

```md
---
name: my-skill
description: Use this when ...
---

# my-skill

## Purpose
Explain the workflow.

## Steps
1. Do the first thing.
2. Do the next thing.
```

Good descriptions say when to use the skill, not just what it is called.

## Initial skill

MiniOpenClaw creates an initial skill for scaffolding new skills:

```text
workspace/skills/skill-create-new-skill/SKILL.md
```

Use it as a starting point for authoring additional workspace skills.

## Related pages

- [Slash commands](slash-commands.md)
- [Runtime layout](runtime-layout.md)
- [Agent capabilities](agent-capabilities.md)
