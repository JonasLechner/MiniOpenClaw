---
title: Gateway HTTP API
---

# Gateway HTTP API

MiniOpenClaw exposes a small local HTTP API from the gateway.

## Purpose

The gateway API is mainly useful for:

- health checks
- inspecting sessions
- creating a new session
- reading session event history

## Base address

Configured with:

- `gateway.host`
- `gateway.port`

Default:

```text
http://127.0.0.1:3000
```

## Endpoints

### `GET /health`
Returns basic health status.

### `GET /sessions`
Returns the known sessions.

### `GET /sessions/current`
Returns the current session.

### `POST /sessions/new`
Creates a new session.

### `GET /sessions/:sessionId/events`
Returns the event history for a specific session.

If the session does not exist, the gateway returns `404`.

## Notes

- sessions are durable and stored locally
- session files are append-only logs
- the API is local by default because the default bind host is `127.0.0.1`

## Related pages

- [Configuration](configuration.md)
- [Everyday usage](using-miniopenclaw.md)
