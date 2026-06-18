# MiniOpenClaw

Minimal TypeScript repo for a long-running personal agent.

## Getting Started

### Quick setup from the submitted ZIP

Requirements:
- Node.js 20 or newer
- npm
- Optional: Docker if container sandboxing is enabled

Run all commands from the extracted project directory:

```bash
npm install
npm run build
npm run onboard
```

Start the gateway:

```bash
npm run gateway
```

The dashboard is available at `http://localhost:3000/` by default.

Open the local TUI agent:

```bash
npm run agent
```

Credentials are configured during onboarding and stored locally in `~/.mini-openclaw/auth.json`.

Note: the TUI (`npm run agent`) runs through Bun, which is installed automatically by `npm install`. Other commands run on Node.

The `bash` tool requires `bash` to be available on `PATH`. On Windows, install Git Bash and ensure it is on `PATH`.

### 2. Runtime directory and config

MiniOpenClaw stores runtime state in `~/.mini-openclaw/`. This directory, the default `config.json`, and other runtime files are created automatically on first start. The agent workspace defaults to `~/.mini-openclaw/workspace/`, but can be moved with `workspacePath`.

Onboarding/profile setup maintains `workspace/user.md`; the agent system prompt injects that same file. See `docs/runtime-layout.md` for the full file layout.

You only need to edit `~/.mini-openclaw/config.json` yourself if you want to change defaults. For safety, MiniOpenClaw's agent should not read or edit its own `config.json` or `auth.json`; otherwise it could inspect credentials or weaken sandbox settings. See [Config](#config) for an example.

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
npm run gateway
```

Alternatively, start and manage the gateway in the background:

```bash
npm run gateway-service
npm run gateway-service:status
npm run gateway-service:restart
npm run gateway-service:stop
```

Open the agent TUI:

```bash
npm run agent
```

The dashboard is available at `http://localhost:3000/` by default.

Both the gateway and agent will warn or fail early if authentication is missing. To switch or refresh authentication later, run `npm run auth`.

When chatting over Telegram, the agent can also use the `subagent` tool to launch detached background work. Those detached runs reply back into Telegram and their results are appended into the main session for follow-up.

For the full docs map, see `docs/index.md`.

## Commands

- `npm run agent` — open the agent TUI
- `npm run auth -- [provider] [oauth|api-key] [key]` — authenticate with a selected provider
- `npm run onboard` — rerun onboarding
- `npm run gateway` — start the gateway in the foreground
- `npm run gateway-service` — start the gateway in the background
- `npm run gateway-service:restart|gateway-service:stop|gateway-service:status` — manage the background gateway
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
    "reasoning": "medium",
    "availableModels": {
      "github-copilot": ["gpt-5.4-mini"],
      "openai-codex": ["gpt-5.4", "gpt-5.4-mini"]
    }
  },
  "sandbox": {
    "enabled": true,
    "engine": "auto",
    "image": "miniopenclaw-sandbox:local",
    "network": "none",
    "memoryMb": 2048,
    "cpus": 2,
    "pidsLimit": 256
  },
  "logging": {
    "level": "info",
    "file": true
  },
  "workspaceSearch": {
    "enabled": true,
    "include": ["memory/**", "project/**", "projects/**"]
  }
}
```

## Agent

`npm run agent` launches the local TUI and requires an interactive TTY. The Bun runtime used by the TUI is installed automatically by `npm install`.
For non-interactive access, use the gateway.

## Sandbox image

By default, the container sandbox now uses the local image tag `miniopenclaw-sandbox:local`.
When Docker starts a sandbox and that image does not exist yet, MiniOpenClaw will build it from `docker/sandbox.Dockerfile`.
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
