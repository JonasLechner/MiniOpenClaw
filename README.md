# MiniOpenClaw

Minimal TypeScript repo with two entrypoints:

- `src/gateway/index.ts` — Fastify gateway daemon
- `src/agent/index.ts` — pi-ai agent CLI

All runtime files live in `~/.mini-openclaw/`:

- `config.json`
- `auth.json`
- `sessions/`
- `workspace/`
- `workspace/memory/`

No `.env` file is used.

## Commands

- `npm install` — install dependencies
- `npm run build` — compile to `dist/`
- `npm start` — start the gateway
- `npm run start:gateway` — start the gateway
- `npm run start:agent` — start the agent CLI
- `npm run dev` — TypeScript watch mode
- `npm run lint` — run ESLint
- `npm run lint:fix` — fix ESLint issues
- `npm test` — run Vitest

## Config

`~/.mini-openclaw/config.json`

```json
{
  "workspacePath": "/absolute/or/relative/path",
  "gateway": {
    "host": "127.0.0.1",
    "port": 3000
  },
  "agent": {
    "provider": "openai-codex",
    "modelId": "gpt-5.4-mini"
  }
}
```

## Gateway

Endpoints:

- `GET /health`
- `GET /sessions`
- `GET /sessions/current`
- `POST /sessions/new`
- `GET /sessions/:sessionId/events`

Sessions are stored as append-only JSONL files in `~/.mini-openclaw/sessions/`.
The current session is inferred as the most recently updated session file.

## Agent

The example config above uses the `openai-codex` OAuth provider. On first run you will be
prompted to authenticate in your browser. OAuth tokens are stored in
`~/.mini-openclaw/auth.json`.

For API-key providers, add credentials to `~/.mini-openclaw/auth.json`:

```json
{
  "openai": {
    "type": "apiKey",
    "apiKey": "your-api-key"
  }
}
```

Start with:

```bash
npm run start:agent
```
