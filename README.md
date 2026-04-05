# Otpravkarr

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)

Bridges Plex user accounts to [Dispatcharr](https://github.com/Dispatcharr/Dispatcharr) IPTV — generates per-user M3U/EPG URLs, syncs Plex friends automatically, and provides an admin dashboard for management.

## Prerequisites

- [Bun](https://bun.sh) >= 1.2
- Docker (optional, for production)

## Quick Start

```bash
bun install
export OTPRAVKARR_SECRET=$(openssl rand -base64 32)
bun --bun run dev
```

The dev server starts at `http://localhost:5173`. A bootstrap token will appear in the console — use it to complete the setup wizard.

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
      - OTPRAVKARR_SECRET=<your-secret>
      - ORIGIN=https://otpravkarr.example.com
    restart: unless-stopped
```

Generate a secret: `openssl rand -base64 32`

## First-Run Setup

1. Start the container — a one-time **bootstrap token** appears in the logs
2. Visit the app URL and enter the token
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

**`GET /api/health`** — Returns application health status.

```json
{
  "status": "ok | degraded | unhealthy",
  "checks": {
    "plex": { "status": "...", "lastChecked": "..." },
    "dispatcharr": { "status": "connected | disconnected", "reachable": true, "authValid": true, "lastChecked": "..." },
    "database": { "status": "...", "lastChecked": "..." }
  },
  "uptime": 3600,
  "version": "0.0.1"
}
```

## Architecture

See [`docs/otpravkarr-prd.md`](docs/otpravkarr-prd.md) for the full product requirements and architecture overview.

## License

[AGPL-3.0](LICENSE)
