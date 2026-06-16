---
title: Configuration
---

# Configuration

Main config file:

```text
~/.mini-openclaw/config.json
```

MiniOpenClaw creates this file automatically if it does not exist. Relative workspace paths are resolved relative to the runtime home, not the process current directory.

`config.json` is user-managed. The agent should not read or edit it, because changing it could weaken safety settings such as sandboxing or Telegram access control.

## Full example

```json
{
  "workspacePath": "/absolute/or/relative/path",
  "gateway": {
    "host": "127.0.0.1",
    "port": 3000,
    "telegram": {
      "enabled": false,
      "token": "YOUR_BOT_TOKEN",
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
    "level": "info"
  },
  "workspaceSearch": {
    "enabled": true,
    "include": ["memory/**", "project/**", "projects/**"]
  }
}
```

## Top-level options

### `workspacePath`
Path to the agent workspace.

- optional
- if omitted, MiniOpenClaw uses `~/.mini-openclaw/workspace/`
- relative paths are resolved relative to `~/.mini-openclaw/`

## `gateway`
Controls the local backend service.

### `gateway.host`
Bind address for the gateway.

- type: string
- default: `127.0.0.1`

### `gateway.port`
Port for the gateway.

- type: positive integer
- default: `3000`

### `gateway.telegram`
Telegram transport settings.

#### `gateway.telegram.enabled`
Enable or disable Telegram support.

- type: boolean
- default: `false`

#### `gateway.telegram.token`
Telegram bot token from BotFather.

- type: string
- required for the Telegram gateway app to start
- if `enabled` is true but `token` is missing, the gateway still starts but Telegram polling is not created

#### `gateway.telegram.polling`
Whether the gateway should poll Telegram for updates.

- type: boolean
- default: `true`
- if `false`, the Telegram gateway app is not created

#### `gateway.telegram.allowedUserIds`
List of Telegram user ids allowed to use the bot.

- type: array of strings
- default: `[]`
- when empty, all Telegram users who can reach the bot are allowed
- values are strings, for example `"123456789"`

## `agent`
Controls model selection.

### `agent.provider`
Provider id to use.

- type: string
- example: `openai-codex`

### `agent.modelId`
Model id to use for the selected provider.

- type: string
- example: `gpt-5.4-mini`

### `agent.reasoning`
Optional provider-specific reasoning mode.

- type: string
- optional

### `agent.availableModels`
Optional allowlist of models grouped by provider.

- type: object mapping provider ids to arrays of model ids
- if present, `agent.provider` must exist as a key
- if present, `agent.modelId` must be listed under the selected provider

## `sandbox`
Controls command isolation.

### `sandbox.enabled`
Turn sandboxing on or off.

- type: boolean
- default: `true`

When disabled, bash commands run on the host machine in the configured workspace.

### `sandbox.engine`
Container engine selection.

- type: `auto`, `docker`, or `podman`
- default: `auto`

### `sandbox.image`
Container image to use.

- type: string
- default: `miniopenclaw-sandbox:local`

If the default image does not exist yet, MiniOpenClaw builds it automatically for Docker/Podman container sandboxes.

### `sandbox.network`
Network mode for the sandbox.

- type: `none` or `default`
- default: `none`

### `sandbox.memoryMb`
Optional memory limit for sandbox containers.

- type: positive integer

### `sandbox.cpus`
Optional CPU limit for sandbox containers.

- type: positive number

### `sandbox.pidsLimit`
Optional process count limit for sandbox containers.

- type: positive integer

## `logging`
Controls log verbosity.

### `logging.level`
- type: `debug`, `info`, `warn`, or `error`
- default: `info`

## `workspaceSearch`
Controls the local SQLite full-text workspace search index.

Indexing starts in the background after the gateway is ready; it does not block Telegram startup.

### `workspaceSearch.enabled`
Enable or disable background indexing.

- type: boolean
- default: `true`

### `workspaceSearch.include`
Workspace-relative glob-like paths to index.

- type: array of strings
- default: `["memory/**", "project/**", "projects/**"]`
- supported forms include exact paths, `dir/*`, and recursive `dir/**`
- hard safety excludes still apply, including `.pi`, `.git`, `node_modules`, SQLite files, unknown/binary extensions, and oversized files

## Validation notes

MiniOpenClaw validates the config file on startup and fails early if values have the wrong type or an invalid combination.

Examples:

- `gateway.port`, `sandbox.memoryMb`, and `sandbox.pidsLimit` must be positive integers.
- `sandbox.cpus` must be a positive number.
- `sandbox.engine` must be `auto`, `docker`, or `podman`.
- `sandbox.network` must be `none` or `default`.
- `logging.level` must be `debug`, `info`, `warn`, or `error`.
- `workspaceSearch.enabled` must be a boolean.
- `workspaceSearch.include` must be an array of non-empty strings.
- if `agent.availableModels` is set, `agent.provider` must be one of its keys.
- if both `agent.availableModels` and `agent.modelId` are set, the selected model must be listed under the selected provider.

## Auth file

Provider credentials are stored separately in:

```text
~/.mini-openclaw/auth.json
```

This file is also user-managed. The agent should not read or edit it, because it may contain credentials or refresh tokens.

## Related pages

- [Getting started](getting-started.md)
- [Runtime layout](runtime-layout.md)
- [Sandbox](sandbox.md)
- [Using MiniOpenClaw](using-miniopenclaw.md)
- [Troubleshooting](troubleshooting.md)
