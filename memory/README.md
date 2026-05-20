# Memory layout

This folder is the human-readable memory store.

## Retrieval strategy
- Rebuild: lazy - only append new content
- Ranking: keyword-first

## Source of truth
- Markdown files under the category folders are the source of truth.
- `index.json` is only a fast lookup catalog.
- `index.json` can be rebuilt from the markdown files.

## Folders
- `projects/` — durable project facts
- `decisions/` — important decisions and rationale
- `preferences/` — user or agent preferences
- `session-summaries/` — compacted summaries of prior sessions

## Index shape
See `index.schema.json`.
