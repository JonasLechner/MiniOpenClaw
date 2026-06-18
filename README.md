# MiniOpenClaw

Minimal TypeScript repo for a long-running personal agent with two entrypoints:

- `src/gateway/index.ts` — Fastify gateway daemon
- `src/agent/cli.ts` — local TUI agent

All runtime files live in `~/.mini-openclaw/`:

- `config.json` — user-managed; the agent must not read or edit this file
- `auth.json` — user-managed credentials; the agent must not read or edit this file
- `sessions/`
- `workspace/`
- `workspace/memory/`
- `workspace/project/`
- `workspace/skills/`
- `workspace/context.md`
- `workspace/user.md`
- `workspace/miniopenclaw-docs/` — generated read-only docs snapshot for sandboxed agents

No `.env` file is used.

See `docs/index.md` for the full documentation map.

## Getting Started

### Quick setup from the submitted ZIP

Requirements:
- Node.js 20 or newer
- npm
- Optional: Docker or Podman if container sandboxing is enabled

Run all commands from the extracted project directory:

```bash
npm install
npm run build
npm run onboard
```

Start the gateway:

```bash
npm run start:gateway
```

Open the local TUI agent:

```bash
npm run start:agent
```

Credentials are configured during onboarding and stored locally in `~/.mini-openclaw/auth.json`. Do not commit or submit this file.

Note: the TUI (`npm run start:agent`) runs through Bun, which is installed automatically by `npm install`. Other commands run on Node.

### 2. Runtime directory and config

MiniOpenClaw stores everything in `~/.mini-openclaw/`. This directory, the default `config.json`, and other runtime files are created automatically on first start. On startup it also ensures these workspace paths exist:

- `workspace/memory/`
- `workspace/project/`
- `workspace/skills/`
- `workspace/context.md`
- `workspace/user.md`
- `workspace/miniopenclaw-docs/`

You only need to edit `~/.mini-openclaw/config.json` yourself if you want to change defaults. For safety, MiniOpenClaw's agent should not read or edit its own `config.json` or `auth.json`; otherwise it could inspect credentials or weaken sandbox settings. Example config:

```json
{
  "gateway": {
    "host": "127.0.0.1",
    "port": 3000,
    "telegram": {
      "enabled": false,
      "polling": true,
      "allowedUserIds": []
    }
  },
  "agent": {
    "provider": "openai-codex",
    "modelId": "gpt-5.4-mini",
    "availableModels": {
      "github-copilot": ["gpt-5.4-mini"],
      "openai-codex": ["gpt-5.4", "gpt-5.4-mini"]
    }
  },
  "sandbox": {
    "enabled": true,
    "engine": "auto",
    "image": "miniopenclaw-sandbox:local",
    "network": "none"
  }
}
```

### 3. Set up Telegram (optional)

To chat with the agent over Telegram:

1. Message [@BotFather](https://t.me/BotFather) on Telegram and create a new bot with `/newbot`. Copy the bot token.
2. Find your Telegram user ID — the easiest way is to message [@userinfobot](https://t.me/userinfobot) and it will reply with your numeric ID.
3. Update `~/.mini-openclaw/config.json`:

```json
{
  "gateway": {
    "telegram": {
      "enabled": true,
      "token": "YOUR_BOT_TOKEN",
      "polling": true,
      "allowedUserIds": ["YOUR_USER_ID"]
    }
  }
}
```

Only users in `allowedUserIds` can interact with the bot. If the list is empty and Telegram is enabled, the bot accepts messages from anyone.

Telegram commands:
- `/start` — show command help
- `/new` — start a new bound session
- `/session` — show the current bound session, model, and active run state
- `/bg <prompt>` — run a detached background agent; the result is sent back to Telegram and ingested into the current session
- `/bglist` — list background tasks for the current session
- `/bgstop <taskId>` — stop a queued or running background task for the current session
- `/compact` — compact the current session
- `/stop` — abort the current foreground run

Agent skill prompts can also use `/skill:<name> [arguments]`.

### 4. First-time onboarding

Run onboarding on first start. It guides you through provider/model selection, authentication, optional Telegram setup, and initial memory/profile setup:

```bash
npm run onboard
```

### 5. Start the system

Start the gateway in the foreground (includes Telegram polling if enabled):

```bash
npm run start:gateway
```

Alternatively, start and manage the gateway in the background:

```bash
npm run gateway
npm run gateway:status
npm run gateway:stop
```

Open the agent TUI:

```bash
npm run start:agent
```

Both the gateway and agent will warn or fail early if authentication is missing. To switch or refresh authentication later, run `npm run auth`.

When chatting over Telegram, the agent can also use the `subagent` tool to launch detached background work. Those detached runs reply back into Telegram and their results are appended into the main session for follow-up.

For the full docs map, see `docs/index.md`.

## Commands

- `npm run start:agent` — open the agent TUI
- `npm run auth -- [provider]` — authenticate with a selected OAuth provider
- `npm run onboard` — rerun onboarding
- `npm run start:gateway` — start the gateway in the foreground
- `npm run gateway` — start the gateway in the background
- `npm run gateway:restart|gateway:stop|gateway:status` — manage the background gateway
- `npm run build` — compile to `dist/`
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
    "modelId": "gpt-5.4-mini",
    "availableModels": {
      "github-copilot": ["gpt-5.4-mini"],
      "openai-codex": ["gpt-5.4", "gpt-5.4-mini"]
    }
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
Current sessions are tracked separately for the TUI and gateway in a small JSON map under `~/.mini-openclaw/`.
This project is intended to keep session state over time rather than behave like a short-lived coding-agent workflow.

See `docs/sessions.md` for the session and compaction model.

## Agent

`npm run start:agent` launches the local TUI and requires an interactive TTY. The Bun runtime used by the TUI is installed automatically by `npm install`.
For non-interactive access, use the gateway.

## Sandbox image

By default, the container sandbox now uses the local image tag `miniopenclaw-sandbox:local`.
When Docker or Podman starts a sandbox and that image does not exist yet, MiniOpenClaw will build it from `docker/sandbox.Dockerfile`.
Sandbox containers mount the configured workspace at `/workspace`. They are shared per workspace by default and may intentionally outlive the CLI process so they can be reused across sessions and resumes.

The default sandbox image includes common coding tools such as:

- `bash`
- `git`
- `jq`
- `rg`
- `python3`
- `curl`

You can still override `sandbox.image` in `~/.mini-openclaw/config.json` to use your own image instead.
If your image supports package installation, the agent can also install extra tools inside the container as needed.
