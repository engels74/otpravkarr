<p align="center">
  <img src="static/otpravkarr-icon.svg" alt="Otpravkarr Logo" width="256" height="256">
</p>

<h1 align="center">Otpravkarr</h1>

<p align="center">
  <strong>Plex user provisioning and per-user IPTV access for Dispatcharr</strong>
</p>

<p align="center">
  <a href="https://github.com/engels74/otpravkarr/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/bun-%23000000.svg?logo=bun&logoColor=white" alt="Bun">
  <img src="https://img.shields.io/badge/SvelteKit-FF3E00?logo=svelte&logoColor=white" alt="SvelteKit">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white" alt="SQLite">
  <a href="https://deepwiki.com/engels74/otpravkarr"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"></a>
</p>

## Prerequisites

- [Bun](https://bun.sh) >= 1.2
- Docker (optional, for production)

## Quick Start

```bash
bun install
export OTPRAVKARR_SECRET=$(openssl rand -base64 32)
bun --bun run dev
```

The dev server binds to `PORT` (default `3000`) and fails fast if that port is busy, so startup stays aligned with `ORIGIN`. With defaults it starts at `http://localhost:3000`. A bootstrap token will appear in the console — use it to complete the setup wizard.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `OTPRAVKARR_SECRET` | **Yes** | — | Master encryption secret (>= 32 random bytes, base64) |
| `DATABASE_PATH` | No | `./data/otpravkarr.sqlite` | SQLite database file path |
| `HOST` | No | `0.0.0.0` | Listen address |
| `PORT` | No | `3000` | Listen port |
| `ORIGIN` | No | `http://localhost:3000` | Public URL (must match actual deployment URL) |

## Docker Deployment

```yaml
services:
  otpravkarr:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    environment:
      - NODE_ENV=production
      - OTPRAVKARR_SECRET=<your-secret>
      - ORIGIN=https://otpravkarr.example.com
    restart: unless-stopped
```

Generate a secret: `openssl rand -base64 32`

## First-Run Setup

1. Start the container — a one-time **bootstrap token** and setup URL appear in the logs
2. Visit the setup URL and manually enter the token
3. Complete the setup wizard (Plex + Dispatcharr credentials)

Complete the wizard immediately; the bootstrap token is single-use.

## Production Checklist

- [ ] Strong `OTPRAVKARR_SECRET` (>= 32 random bytes, base64-encoded)
- [ ] `ORIGIN` matches your actual deployment URL
- [ ] Persistent volume mounted for `./data` (SQLite lives here)
- [ ] Reverse proxy with TLS termination in front
- [ ] Proxy forwards `X-Forwarded-For` header (needed for rate limiting)
- [ ] Set `PROTOCOL_HEADER=x-forwarded-proto` and `HOST_HEADER=x-forwarded-host` in env
- [ ] Verify bootstrap token appears in container logs on first run
- [ ] Complete setup wizard immediately after first start

## API

**`GET /api/health`** — Returns coarse application health status (unauthenticated). The `status` field is one of `"ok"`, `"degraded"`, or `"unhealthy"`.

```json
{
  "status": "ok"
}
```

**`GET /api/internal/health`** — Returns the full health payload (admin session required). The top-level `status` is one of `"ok"`, `"degraded"`, or `"unhealthy"`; `checks.dispatcharr.status` is `"connected"` or `"disconnected"`.

```json
{
  "status": "ok",
  "checks": {
    "plex": { "status": "healthy", "lastChecked": "2026-01-01T00:00:00.000Z" },
    "dispatcharr": { "status": "connected", "reachable": true, "authValid": true, "lastChecked": "2026-01-01T00:00:00.000Z" },
    "database": { "status": "healthy", "lastChecked": "2026-01-01T00:00:00.000Z" }
  },
  "uptime": 3600,
  "version": "0.0.1"
}
```

## Architecture

See [`docs/otpravkarr-prd.md`](docs/otpravkarr-prd.md) for the full product requirements and architecture overview.

## License

[AGPL-3.0](LICENSE)
