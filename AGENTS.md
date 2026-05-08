# AGENTS.md

## Project
Minimal TypeScript project.

## Current setup
- Entry point: `src/index.ts`
- Build output: `dist/`
- TypeScript config: `tsconfig.json`
- Package manager: `npm`

## Commands
- Install: `npm install`
- Build: `npm run build`
- Run: `npm start`
- Watch: `npm run dev`

## Conventions
- Keep the project minimal unless asked otherwise.
- Always use TypeScript for source files.
- Do not add extra tooling or metadata unless requested.
- Ask before adding major dependencies or changing project structure.

## Collaboration / Git workflow
- This repository is collaboratively maintained.
- Make minimal, focused changes only.
- Do not modify unrelated files.
- Preserve existing work and avoid overwriting teammate changes.
- Do not create or switch branches unless explicitly asked.
- Do not force-push or rewrite git history.
- Only create commits when explicitly requested.
- Before committing, ask the user to review the changes.
- Use clear, descriptive commit messages with meaningful explanations.
- Remind the user to switch branches if they are on `master`.
- Always use feature branches for larger changes.
- Check the working tree before making changes and mention potential conflicts.
- Do not commit `node_modules/`.
- Only commit build output like `dist/` if explicitly requested.
- Summarize all changed files after completing work.

## Notes for coding agents
- Read this file before making changes.
- Preserve the minimal setup.
- Make focused edits only.
