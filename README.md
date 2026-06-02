# MiniOpenClaw

Minimal TypeScript repo for a long-running personal agent with two entrypoints:

- `src/gateway/index.ts` — Fastify gateway daemon
- `src/agent/cli.ts` — local TUI agent

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
- `npm run start:agent` — start the agent TUI
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
  },
  "sandbox": {
    "enabled": true,
    "engine": "auto",
    "image": "miniopenclaw-sandbox:local",
    "network": "none"
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
This project is intended to keep session state over time rather than behave like a short-lived coding-agent workflow.

## Agent

`npm run start:agent` launches the local TUI and requires an interactive TTY.
For non-interactive access, use the gateway.


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

Start the TUI with:

```bash
npm run start:agent
```

## Sandbox image

By default, the container sandbox now uses the local image tag `miniopenclaw-sandbox:local`.
When Docker or Podman starts a sandbox and that image does not exist yet, MiniOpenClaw will build it from `docker/sandbox.Dockerfile`.
Sandbox containers are session-scoped by default and may intentionally outlive the CLI process so they can be reused when the agent resumes.

The default sandbox image includes common coding tools such as:

- `bash`
- `git`
- `jq`
- `rg`
- `python3`
- `curl`

You can still override `sandbox.image` in `~/.mini-openclaw/config.json` to use your own image instead.
If your image supports package installation, the agent can also install extra tools inside the container as needed.
