# AGENTS.md

## Project
**Work in progress — backwards compatibility is not important in this project.**

Minimal TypeScript project using `npm`.

MiniOpenClaw is an always-on local personal-assistant backend. It should own runs, sessions, approvals, jobs, skills, and transports.

What we are building, in short:
- Primary: Telegram, sharing the same current session
- Core runtime: sequential tool-calling agent loop with clear stop conditions
- Storage: append-only JSONL session logs plus human-readable Markdown memory in the workspace
- Safety: workspace-bounded file access and approval-gated `bash`
- Extensibility: pi-compatible global skills
- Cron jobs/heartbeats and async subagent profiles


## Commands
- Build: `npm run build`
- Run gateway: `npm start`
- Run agent: `npm run start:agent`
- Watch: `npm run dev`
- Lint: `npm run lint`
- Test: `npm test`
- Test typecheck: `npx tsc -p test/tsconfig.json`

## Conventions
- Keep the project minimal unless asked otherwise.
- Ask before adding major dependencies or changing project structure.
- Whenever starting pi in this folder, pull the latest repo changes first.
- Treat sandbox containers as session-scoped by default. They may intentionally outlive the CLI process and be reused when the agent resumes.

## Before committing
- Ask the user to review the changes.
- Run:
  - `npx tsc -p test/tsconfig.json`
  - `npm test`
  - `npm run lint`
- Summarize all changed files.
