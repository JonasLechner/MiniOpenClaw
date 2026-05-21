# Memory layout

This folder documents the memory structure only.

The actual runtime memory is written under:
- `~/.mini-openclaw/workspace/memory/`

## Retrieval strategy
- Rebuild: lazy - only append new content
- Ranking: keyword-first

## Source of truth
- At runtime, markdown files under `~/.mini-openclaw/workspace/memory/` are the source of truth.
- `index.json` is only a fast lookup catalog.
- `index.json` can be rebuilt from the markdown files.

## Folders
- `projects/` — durable project facts
- `decisions/` — important decisions and rationale
- `preferences/` — user or agent preferences
- `session-summaries/` — compacted summaries of prior sessions

## Index shape
See `index.schema.json`.
