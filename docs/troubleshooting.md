---
title: Troubleshooting
---

# Troubleshooting

## The agent says auth is missing

Run:

```bash
npm run auth
```

If you are using an API-key provider, check `~/.mini-openclaw/auth.json`.

## Telegram is enabled but nothing happens

Check:

- `gateway.telegram.enabled` is `true`
- `gateway.telegram.token` is set
- `gateway.telegram.polling` is `true`
- your Telegram user id is included in `allowedUserIds`, if that list is not empty
- the gateway is running with `npm start`
- you are messaging the bot in a private chat

## Startup fails because provider or model is missing

Set both of these in `~/.mini-openclaw/config.json`:

- `agent.provider`
- `agent.modelId`

If you use `agent.availableModels`, make sure:

- the provider exists as a key
- the model is listed for that provider

## Sandbox startup fails

Common causes:

- Docker or Podman is not installed
- the selected engine is unavailable
- the sandbox image cannot be built or pulled

Things to try:

- install Docker or Podman
- set `sandbox.engine` explicitly to `docker` or `podman`
- temporarily disable sandboxing with `sandbox.enabled: false`

## Telegram user is rejected

If `gateway.telegram.allowedUserIds` is not empty, only listed users can use the bot.

Make sure your numeric Telegram user id is in that list as a string.

## Background tasks or scheduled jobs are not running

Check:

- the gateway is running
- Telegram is enabled
- the chat already has a Telegram-to-session binding
- the scheduled task cron expression is valid
- the job is enabled

Scheduled jobs are checked roughly once per minute, so they are not second-precision.

## I changed config but the system still behaves the same

Restart the gateway and the local agent UI after changing config.

## Where is my data stored?

Runtime state lives under:

```text
~/.mini-openclaw/
```

See [Using MiniOpenClaw](using-miniopenclaw.md) for the main files and folders.
