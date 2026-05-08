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
    "provider": "openai",
    "modelId": "gpt-4o-mini"
  }
}
```

## Gateway

Endpoints:

- `GET /health`

## Agent

For API-key providers, add credentials to `~/.mini-openclaw/auth.json`:

```json
{
  "openai": {
    "type": "apiKey",
    "apiKey": "your-api-key"
  }
}
```

For OAuth providers such as `openai-codex`, store OAuth credentials in the same file.

Start with:

```bash
npm run start:agent
```
