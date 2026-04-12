# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

Bun (≥ 1.2) runtime • SvelteKit 2 + Svelte 5 runes • `svelte-adapter-bun` • UnoCSS (`presetWind4` + `presetShadcn`) + shadcn-svelte • `bun:sqlite` • Biome (lint/format) • Vitest (unit) • Playwright (e2e).

## Commands

Always run lifecycle scripts under the Bun runtime via `bun --bun run <script>` (the `dev`/`build` scripts already do this).

- `bun install` — install deps
- `bun --bun run dev` — dev server on `PORT` (default 3000); fails fast if the port is busy
- `bun --bun run build` — Vite build + copy `src/lib/db/migrations` into `build/server/migrations` (migrations must ship with the build artifact)
- `bun run start` — run built server (`bun ./build/index.js`)
- `bun run check` — Biome lint/format check
- `bun run format` — Biome format --write
- `bun run test` — Vitest (jsdom), excludes `e2e/**`
- `bun run test:e2e` — Playwright (builds the app, seeds a temp SQLite DB, starts the production server on port 4173)
- `bunx svelte-check --threshold warning` and `bunx tsc --noEmit` — type checks (pre-commit also runs these)

Single test:
- Unit: `bunx vitest run path/to/file.test.ts` (or `-t "name"` for a single case)
- E2E: `bunx playwright test e2e/admin-dashboard.spec.ts` (project names: `setup`, `auth`, `login`, `app`, `portal` — most have a `dependencies` chain, see `playwright.config.ts`)

Pre-commit is wired via `prek.toml` (biome-check, svelte-check, tsc --noEmit). Never bypass it.

Master-key rotation: `OLD_SECRET=... NEW_SECRET=... bun scripts/rotate-key.ts` — standalone script that re-encrypts all `encrypted=1` config rows and `dispatcharr_xc_password_enc` columns. Keep its crypto constants (`HKDF_SALT`, `IV_LENGTH`, purpose strings) in sync with `src/lib/crypto/keys.ts` and `encryption.ts`.

## Environment

`OTPRAVKARR_SECRET` is required (≥ 32 chars); `validateEnv()` in `src/lib/server/env.ts` calls `process.exit(1)` if missing/short. Other optional vars: `DATABASE_PATH`, `HOST`, `PORT`, `ORIGIN`, `PROTOCOL_HEADER`, `HOST_HEADER`. On first run with no completed setup, the server prints a single-use **bootstrap token** and `/setup?token=…` URL to stdout — that token lives in memory for 15 min and is invalidated by restart.

## Architecture

Single-process SvelteKit app that bridges Plex user accounts into Dispatcharr IPTV.

**Request pipeline (`src/hooks.server.ts`):** `sequence(requestLogger, localsInit, runtimeInit, setupGate, sessionResolver, csrfValidator, securityHeaders)`. `runtimeInit` is memoized in a module-level promise — it runs `validateEnv()`, `initializeDatabase()` (migrations), registers the four scheduler jobs, prints the bootstrap banner, and marks uptime. `setupGate` redirects everything except `/setup`, `/api/health`, `/_app/*`, `/favicon.ico`, `/robots.txt` to `/setup` until `config.setup_completed === "true"` (falls back to "admin account exists" for legacy installs). `csrfValidator` only runs post-setup and validates `Origin` against `config.allowed_origins` (JSON array) or falls back closed to `env.ORIGIN` / request origin.

**Sessions:** one cookie `otpravkarr_session` with two `session_type`s — `admin` (1 h TTL, `sameSite: strict`) and `user` (4 h TTL, `sameSite: lax`). `sessionResolver` refreshes TTL and re-sets the cookie on every request. `src/lib/server/auth.ts` exports `requireAdmin`, `requireAdminApi`, `requireUser`, `requireSetupIncomplete`, `isSetupComplete`.

**Database:** `bun:sqlite` singleton via `src/lib/db/connection.ts` (WAL + FK on). Migrations are raw `.sql` files in `src/lib/db/migrations/` applied by `migrate.ts`. All DB access goes through repositories in `src/lib/db/repositories/` (`admin`, `audit`, `config`, `sessions`, `users`) — do not hit the DB directly from routes. Tests swap in `:memory:` via `createDatabase(":memory:")` + `_resetForTesting()`.

**Crypto:** `src/lib/crypto/keys.ts` derives per-purpose AES-GCM keys from `OTPRAVKARR_SECRET` via HKDF-SHA256 (`otpravkarr-hkdf-v1` salt, `config-encryption` / `credential-encryption` info). `encryption.ts` stores `iv ‖ ciphertext` as base64. Encrypted config values live in `config` rows with `encrypted=1`; per-user Dispatcharr passwords live in `user_mappings.dispatcharr_xc_password_enc`.

**Scheduler (`src/lib/scheduler/runner.ts`):** in-process `setTimeout`-based scheduler with overlap guards, generation counters (to kill zombie timers after re-registration), and `runExclusive()` for API-triggered runs. Four jobs are registered on startup: `sync` (Plex friends → Dispatcharr), `health`, `cleanup`, `audit-rotation` (`src/lib/scheduler/jobs/*.ts`).

**Bridge (`src/lib/bridge/`):** `provisioner.ts` creates/reactivates Dispatcharr accounts for a Plex identity; `lifecycle.ts` runs the friend-sync reconciliation and returns a `SyncReport` (`unmappedFriends`, `disabled`, `orphaned`, `refreshed`, `errors`). Plex OAuth + friends live in `src/lib/plex/`; the Dispatcharr REST client lives in `src/lib/dispatcharr/` (`client.ts`, `pagination.ts`, `schemas.ts`).

**Routes:** grouped by role.
- `src/routes/(admin)/` — admin dashboard, users, settings, audit (protected by `requireAdmin` in each `+layout.server.ts`).
- `src/routes/(portal)/` — Plex-authenticated end-user portal (`auth/` = Plex OAuth, `welcome/` = per-user URLs). The portal-URL generation for M3U/EPG/Xtream lives in `src/lib/url/`.
- `src/routes/api/health/` — public health JSON; `src/routes/api/internal/` — admin-only job triggers.
- `src/routes/setup/` — one-time wizard gated by bootstrap token.
- `src/routes/login/` — admin login.

**UI:** shadcn-svelte components copy-pasted under `src/lib/components/ui/`; app-specific composites at `src/lib/components/` (`AdminSidebar.svelte`, `SetupWizard.svelte`, etc.). Design tokens are OKLCH-based in `src/app.css` (Dark Matter theme); UnoCSS shortcuts like `page-shell`, `card`, `surface`, `surface-elevated`, `glass-header`, `kpi-tile`, `eyebrow`, `display-hero`, `hero-glow-bg`, `cta-glow` are defined in `uno.config.ts` — prefer these over ad-hoc class strings. The UnoCSS content pipeline already includes `.ts`/`.js`/`.svelte.ts` — `tv()`/variants in TS files will be extracted.

**CSP (`svelte.config.ts`):** strict `script-src 'self'`, `frame-ancestors 'none'`, Plex image/connect allow-list. Do not relax this without reason.

## Conventions

- **Svelte 5 runes only** — no legacy `$:`, stores, or `<slot>`. Use `$state`, `$derived`, `$effect`, `$props`, `{@render ...}`. Shared reactive state belongs in `.svelte.ts` modules under `src/lib/state/`.
- **Server-only code** goes under `$lib/server/**` (SvelteKit enforces no client import). Don't reach for `$env/static/private` — the app uses `$env/dynamic/private` throughout so runtime env changes are picked up.
- **TypeScript is strict** (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`, `verbatimModuleSyntax`). Biome overrides: unused vars off, `noExplicitAny` off, import-type rule off for `.svelte`. Line width 100, 2-space indent.
- **Tests are colocated** in `__tests__/` directories next to the code they cover (e.g. `src/routes/(admin)/users/__tests__/page.server.test.ts`). Vitest aliases `$app/forms` to `src/lib/test-stubs/app-forms.ts`; add new `$app/*` stubs there if tests need them.
- **Playwright projects depend on each other** — the `setup` project runs the wizard, `auth` captures an admin storage state, then `app`/`portal` reuse it. Don't `fullyParallel`; the shared seeded SQLite forbids it.
- **Pre-commit branch guard:** `no-commit-to-branch --branch main`. Use feature branches.

## Project-specific rules

`.augment/rules/bun-svelte-pro.md` is the in-repo reference for Bun + Svelte 5 + SvelteKit 2 + UnoCSS + shadcn-svelte patterns. Consult it when writing new Svelte/SvelteKit code rather than inventing patterns.
