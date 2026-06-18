---
title: Gateway HTTP API
---

# Gateway HTTP API

MiniOpenClaw exposes a small local HTTP API from the gateway.

## Purpose

The gateway API is mainly useful for:

- health checks
- inspecting sessions

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


## Notes

- sessions are durable and stored locally
- session files are append-only logs
- the API is local by default because the default bind host is `127.0.0.1`

## Related pages

- [Configuration](configuration.md)
- [Everyday usage](using-miniopenclaw.md)
