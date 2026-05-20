# AGENTS.md

## Project
Minimal TypeScript project using `npm`.

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

## Before committing
- Ask the user to review the changes.
- Run:
  - `npx tsc -p test/tsconfig.json`
  - `npm test`
  - `npm run lint`
- Summarize all changed files.
