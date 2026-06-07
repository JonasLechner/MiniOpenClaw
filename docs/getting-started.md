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

MiniOpenClaw uses this directory for all runtime state:

```text
~/.mini-openclaw/
```

You usually do not need to create it yourself. It is created automatically on first start.

## 3. Configure the agent

Edit:

```text
~/.mini-openclaw/config.json
```

A minimal example:

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

See [Configuration](configuration.md) for the full reference.

## 4. Authenticate

Run:

```bash
npm run auth
```

This opens the provider login flow and stores credentials in:

```text
~/.mini-openclaw/auth.json
```

If you use an API-key provider instead of OAuth, you can create the file manually:

```json
{
  "openai": {
    "type": "apiKey",
    "apiKey": "sk-..."
  }
}
```

## 5. Optional: connect Telegram

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

You can also pass an explicit OAuth provider id in non-interactive environments:

```bash
npm run auth -- openai-codex
```

## 6. Start MiniOpenClaw

In one terminal, start the gateway:

```bash
npm start
```

In another terminal, start the local agent UI:

```bash
npm run start:agent
```

## First things to try

### In Telegram

- `/start`
- `/session`
- `/new`
- `/bg write me a summary of today's logs`
- send a normal message

### In the local agent UI

- type a prompt and press Enter
- `/new` to start a fresh session
- `/clear` to clear the visible chat pane
- `/quit` to exit

## Related pages

- [Configuration](configuration.md)
- [Telegram](telegram.md)
- [Using MiniOpenClaw](using-miniopenclaw.md)
- [Slash commands](slash-commands.md)
- [Background tasks and scheduled jobs](automation.md)
