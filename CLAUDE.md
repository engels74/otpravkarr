# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Otpravkarr is a SvelteKit 2 + Svelte 5 (runes) app that provisions Plex users and grants them
per-user IPTV access in Dispatcharr. It runs on the **Bun** runtime, persists to a single SQLite
file via `bun:sqlite`, encrypts all third-party credentials at rest, and ships as a
`svelte-adapter-bun` server. Single package (not a monorepo); run all commands from the repo root.

## Commands

| Task | Command | Notes |
|---|---|---|
| Install | `bun install` | |
| Dev server | `bun --bun run dev` | Needs `OTPRAVKARR_SECRET`; binds `PORT` (default 3000, `strictPort`) |
| Build | `bun --bun run build` | `vite build` then copies migrations into `build/server/migrations` |
| Run prod build | `NODE_ENV=production bun ./build/index.js` | `NODE_ENV=production` is required — the adapter/Kit runtime 500s on every SSR route without it |
| Lint + format check | `bun run check` | Biome — lint/format only, **not** types |
| Auto-format | `bun run format` | |
| Type check | `bunx tsc --noEmit` and `bunx svelte-check --threshold warning` | Both run as pre-commit gates |
| Unit tests | `bun run test` | Vitest (jsdom) |
| Single test file | `bunx vitest run <path>` | e.g. `src/lib/server/__tests__/auth.test.ts` |
| Single test by name | `bunx vitest run <path> -t "<test name>"` | |
| E2E tests | `bun run test:e2e` | Playwright; builds, seeds a temp SQLite DB, serves on 4173 |

First run: `export OTPRAVKARR_SECRET=$(openssl rand -base64 32)` then start the server; a single-use
bootstrap token is printed to the logs for the `/setup` wizard. `OTPRAVKARR_SECRET` is required and
strength-validated (`src/lib/server/env.ts` → `process.exit(1)` if missing/weak).

## Architecture and boundaries

Request entry is `src/hooks.server.ts`: `handle = sequence(requestLogger, localsInit, runtimeInit,
setupGate, sessionResolver, csrfValidator, securityHeaders)`. `runtimeInit` runs once and is where
startup happens — `validateEnv()` → `initializeDatabase()` (runs migrations) → `registerSchedulerJobs()`
→ bootstrap banner. `setupGate` redirects everything to `/setup` until the `setup_completed` config flag is set.

Layers (all under `src/lib/`):
- **`db/`** — `connection.ts` exposes the singleton `db` (WAL + foreign keys on). `migrate.ts` applies
  `NNN_name.sql` files tracked in `_migrations`. `types.ts` mirrors the schema. All DB access goes through
  **`db/repositories/*`** (admin, audit, config, sessions, users, channel-group-profiles), which own the
  prepared statements and encryption.
- **`crypto/`** — AES-256-GCM via purpose-scoped HKDF keys (`encryption.ts`, `keys.ts`), bootstrap tokens,
  password hashing, secret strength. The master key derives from `OTPRAVKARR_SECRET`.
- **`dispatcharr/`** — `client.ts` (`DispatcharrClient` over `ofetch`, returns a `DispatcharrResult`),
  `endpoints/` (typed wrappers), `schemas.ts` (Zod), `plugins/` (adapter registry).
- **`plex/`** — Plex API client and OAuth flow.
- **`bridge/`** — domain orchestration across Plex + Dispatcharr + DB (`provisioner.ts`, `lifecycle.ts`,
  `subscription-sync.ts`, `group-profiles.ts`, `quarantine-sync.ts`, `ecm-scope.ts`). Routes/jobs call the
  bridge for provisioning logic rather than reimplementing it.
- **`scheduler/`** — `runner.ts` (the `scheduler` singleton with overlap guards) and `jobs/` (sync, health,
  cleanup, audit-rotation), wired in `registerSchedulerJobs()`.
- **`server/`** — `auth.ts`, `validation.ts`, `csrf.ts`, `ratelimit.ts`, `origins.ts`, `env.ts`.
- **`state/`** — Svelte 5 rune stores (`*.svelte.ts`).

Routes live in `src/routes/` as groups: `(admin)`, `(portal)`, `api/` (`/api/health` public,
`/api/internal/*` admin-only), plus `login` and `setup`.

Auth: cookie `otpravkarr_session`; admin sessions (`sameSite: strict`, TTL 3600s) vs user sessions
(`sameSite: lax`, TTL 14400s). Server actions call `requireAdmin(event)` / `requireUser(event)`
(`src/lib/server/auth.ts`), which redirect on failure.

## Key workflows

**Add a database migration**
1. Create `src/lib/db/migrations/NNN_name.sql` (zero-padded, next sequential version; the runner skips
   files not matching `^(\d+)_(.+)\.sql$`). New tables use `CREATE TABLE IF NOT EXISTS`; `ALTER TABLE ADD
   COLUMN` is safe because each file runs exactly once.
2. Update the matching interface in `src/lib/db/types.ts` and the relevant repository in `db/repositories/`.
3. Migrations apply on startup; the `build` script copies them into `build/server/migrations` for production.

**Add a scheduler job**: add a `create<Name>Job` factory in `src/lib/scheduler/jobs/` returning a `Job`,
then import it and call `scheduler.register(...)` inside `registerSchedulerJobs()` in `src/hooks.server.ts`.

**Add a Dispatcharr plugin adapter**: add an adapter under `src/lib/dispatcharr/plugins/adapters/` and
append it to `pluginAdapters` in `plugins/registry.ts`. Unknown plugins still surface generically.

## Repository-specific rules

- **DB access only through `src/lib/db/repositories/*`.** They centralize prepared statements and
  config encryption — don't run ad-hoc SQL against `db` from routes or the bridge.
- **Persist secrets encrypted.** Use `encrypt(value, purpose)` / `setConfig(key, value, true)`; never store
  or log plaintext credentials. `DispatcharrClient` already redacts response bodies in logs.
- **Credentialled URLs must pass `isSafeHttpSecretUrl`** (`src/lib/server/validation.ts`): HTTPS only, or
  HTTP for loopback hosts. `DispatcharrClient` throws on insecure URLs; the Zod setup schemas refine on it.
- **Validate every external/Dispatcharr response with Zod** and branch on `result.ok` before reading
  `result.data` — the client returns a `DispatcharrResult`, not a raw value.
- **Validate form input server-side** with the Zod schemas + `sanitizeString`/`parseFormData` in
  `src/lib/server/validation.ts` (some routes use `sveltekit-superforms`).
- **`bun run check` does not type-check** — it is Biome lint/format. Run `tsc --noEmit` and `svelte-check`
  separately (both are pre-commit hooks).
- **CSP is strict** (`svelte.config.ts`): no inline `style="..."`. Use component `<style>` blocks or
  data-attribute-driven CSS for dynamic values.
- **Record state-changing admin/user actions** via `appendAuditLog(...)` with an `AuditAction.*` constant
  (`src/lib/db/types.ts`).
- **Commits:** Conventional Commits are enforced and direct commits to `main` are blocked (`prek.toml`);
  branch first. `gitleaks` blocks committed secrets.

## Tests

Unit tests are co-located in `__tests__/` folders next to the code (Vitest, jsdom). Server-only tests
opt into Node with a `// @vitest-environment node` header. `$app/*` modules are aliased to stubs in
`vitest.config.ts` (`src/lib/test-stubs/`). Playwright specs live in `e2e/` (excluded from Vitest) and
run against a fresh built server with a seeded temp DB (`playwright.config.ts`).

## Focused references

- `.augment/rules/bun-svelte-pro.md` — Svelte 5 runes / SvelteKit 2 / Bun / UnoCSS / shadcn-svelte
  coding conventions; read before writing new components or SvelteKit boilerplate.
- `README.md` — environment variables, Docker deployment, first-run setup, and the public API shape.
