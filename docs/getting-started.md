---
title: Getting Started
---

# Getting started

## 1. Install dependencies

```bash
npm install
npm run build
```

## 2. Create the runtime home

MiniOpenClaw uses this directory for config, credentials, sessions, service state, logs, and the default workspace:

```text
~/.mini-openclaw/
```

You usually do not need to create it yourself. It is created automatically on first start. The agent workspace defaults to `~/.mini-openclaw/workspace/`, but can be moved with `workspacePath` in config.

## 3. Run first-time onboarding

Run:

```bash
npm run onboard
```

Onboarding guides provider/model selection, authentication, optional Telegram setup, and initial memory/profile setup. It writes runtime config to:

```text
~/.mini-openclaw/config.json
```

You can edit that file later if you want to change defaults. A representative example:

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

See [Configuration](configuration.md) for the full reference.

## 4. Optional: connect Telegram

Create a bot with [@BotFather](https://t.me/BotFather), then add your bot token and Telegram user id to `config.json`:

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

If `allowedUserIds` is empty, any Telegram user who can reach the bot is allowed to use it.

## 5. Start MiniOpenClaw

In one terminal, start the gateway in the foreground:

```bash
npm start
# equivalent: npm run gateway
```

Or start and manage the gateway in the background:

```bash
npm run gateway-service
npm run gateway-service:status
npm run gateway-service:restart
npm run gateway-service:stop
```

In another terminal, start the local agent UI:

```bash
npm run agent
```

## First things to try

### In Telegram

- `/start`
- `/session`
- `/new`
- `/bg write me a summary of today's logs`
- `/compact`
- send a normal message or image

### In the local agent UI

- type a prompt and press Enter
- `/new` to start a fresh session
- `/clear` to clear the visible chat pane
- `/quit` to exit

## Related pages

- [Configuration](configuration.md)
- [Runtime layout](runtime-layout.md)
- [Telegram](telegram.md)
- [Using MiniOpenClaw](using-miniopenclaw.md)
- [Slash commands](slash-commands.md)
- [Background tasks and scheduled jobs](automation.md)
