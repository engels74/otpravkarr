# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Otpravkarr bridges **Plex** user accounts to **Dispatcharr** IPTV management. It syncs Plex friends automatically, generates per-user M3U/EPG URLs with encrypted credentials, and provides an admin dashboard for user lifecycle management.

**Stack:** SvelteKit 2 + Svelte 5 (runes-only) + Bun runtime + SQLite (via `bun:sqlite`) + UnoCSS (presetWind4) + shadcn-svelte (bits-ui) + TypeScript (strict)

## Commands

```bash
bun install                # Install dependencies
bun run dev                # Dev server at http://localhost:3000
bun run build              # Production build (copies migrations to build/server/)
bun run start              # Run production server (bun ./build/index.js)
bun run test               # Unit tests (vitest run)
bun run test:e2e           # E2E tests (playwright test)
bun run check              # Lint (biome check .)
bun run format             # Auto-format (biome format --write .)
```

To run a single unit test file: `bunx vitest run src/lib/path/to/__tests__/file.test.ts`

E2E tests require a build first and run sequentially — they use a temp SQLite DB with seeded data.

## Pre-commit Hooks (prek)

On commit, these run automatically via `prek`:
1. `biome check --write` on staged files
2. `svelte-check --threshold warning`
3. `tsc --noEmit` (full type check)
4. Builtin checks (trailing whitespace, merge conflicts, large files, private key detection, no commits to `main`)

## Architecture

### Entry Point & Middleware

`src/hooks.server.ts` is the main server entry. It chains middleware via SvelteKit's `sequence()`:

1. **requestLogger** — structured JSON logging
2. **localsInit** — initializes `event.locals`
3. **runtimeInit** — runs DB migrations and starts the scheduler (once)
4. **setupGate** — redirects to `/setup` if first-run setup is incomplete
5. **sessionResolver** — parses session cookie, populates `locals.admin` / `locals.user`
6. **csrfValidator** — origin validation on mutation requests (fail-closed)
7. **securityHeaders** — CSP, X-Frame-Options, etc.

### Route Groups

| Route | Purpose | Auth |
|---|---|---|
| `/setup` | First-run setup wizard (multi-step) | Bootstrap token |
| `/login` | Admin login | None |
| `/(portal)/*` | User portal (Plex OAuth, credential display, M3U export) | User session |
| `/(admin)/*` | Admin dashboard, users, settings, audit | Admin session |
| `/api/health` | Public health check | None |
| `/api/internal/*` | Sync, credential rotation, signout | Admin session |

Parenthesized route groups `(portal)` and `(admin)` are layout groups — they don't affect URL paths.

### Core Modules (`src/lib/`)

- **`db/`** — SQLite connection (singleton, WAL mode), migration runner, and repositories. Each repository uses **lazy-initialized prepared statements** (`stmtX ??= db.prepare(...)`) with a `_resetStatementsForTesting()` export for test isolation.
- **`bridge/`** — Core Plex-to-Dispatcharr logic. `provisioner.ts` handles user creation/reactivation. `lifecycle.ts` handles sync reconciliation, disable/enable, credential rotation.
- **`scheduler/`** — Background job runner (singleton) with overlap guards and catch-up logic. Jobs: sync (15min configurable), health (1min), session cleanup (2h), audit rotation (24h).
- **`crypto/`** — AES-256-GCM encryption via Web Crypto API. Purpose-specific keys derived via HKDF from `OTPRAVKARR_SECRET`. Argon2id password hashing via `Bun.password`.
- **`plex/`** — Plex OAuth flow, friend list fetching, server validation (uses `@ctrl/plex`).
- **`dispatcharr/`** — HTTP client (uses `ofetch`) with typed `DispatcharrResult<T>` responses and Zod-validated schemas.
- **`server/`** — Auth guards (`requireAdmin`, `requireUser`), CSRF, rate limiting, env validation.
- **`url/`** — M3U/EPG URL generation, XC credentials, platform-specific URLs (Kodi, VLC, etc.).
- **`components/ui/`** — shadcn-svelte components (bits-ui based, copy-paste model).

### Data Layer

SQLite with Bun's native driver. Key tables:
- `user_mappings` — maps Plex accounts to Dispatcharr users (encrypted XC passwords)
- `admin_accounts` — admin login (Argon2id hashed passwords)
- `sessions` — short-lived sessions (admin: 1h TTL, user: 4h TTL)
- `config` — key-value config store (supports encrypted values)
- `audit_log` — security event log

Migrations live in `src/lib/db/migrations/` (numbered SQL files), run on startup, tracked in `_migrations` table.

## Conventions

### TypeScript

Strict mode with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`, and `verbatimModuleSyntax` enabled. Bun types available globally.

### Formatting

Biome with 2-space indentation, 100-char line width. Import organization is automatic. `noUnusedImports: warn` (off for `.svelte` files).

### Error Handling Patterns

- **Custom error classes** with typed `name` (`override readonly name = "PlexAuthError" as const`)
- **Result type** for recoverable failures: `{ ok: true; data: T } | { ok: false; error: ErrorCode; message: string }`
- **SvelteKit helpers** in routes: `fail()` for form actions, `error()` for API errors, `redirect()` for navigation
- **Retry with exponential backoff + jitter** (`retryAsync` / `retryResult` in `utils/retry.ts`)

### Svelte 5

Runes-only — use `$state`, `$derived`, `$effect`, `$props()`, `$bindable()`. No legacy stores or reactive statements.

### Input Validation

All user input validated with Zod schemas. Use `parseFormData()` from `server/validation.ts` which sanitizes control chars and collapses whitespace before validating.

### Encryption

Sensitive config values (Plex token, Dispatcharr API key, XC passwords) are encrypted at rest with AES-256-GCM using purpose-specific keys derived from `OTPRAVKARR_SECRET` via HKDF-SHA256.

### Testing

- Unit tests colocated in `__tests__/` directories next to source
- Mock external dependencies with `vi.mock()`
- DB repositories expose `_resetStatementsForTesting()` for isolation
- E2E tests in `e2e/` use Playwright with stored auth state (`e2e/.auth/`)

### Environment

Required: `OTPRAVKARR_SECRET` (base64, >= 32 random bytes). Optional: `DATABASE_PATH`, `HOST`, `PORT`, `ORIGIN`.

Dev startup: `export OTPRAVKARR_SECRET=$(openssl rand -base64 32) && bun run dev`

On first run, a bootstrap token prints to console for the setup wizard.
