# AGENTS.md

This file provides guidance to AI coding agents when working with code in this
repository.

Otpravkarr provisions Plex users into Dispatcharr (IPTV) and serves each user their own
credentials/playlist. Bun + SvelteKit 2 + Svelte 5 runes + `bun:sqlite`, deployed via
`svelte-adapter-bun`.

## Commands

`bun install` first; `.npmrc` sets `engine-strict=true`. Run everything from the repo root.

| Command | Purpose |
|---|---|
| `bun run dev` | Dev server (script already passes `--bun`). Binds `PORT` (default 3000) with `strictPort: true`, so a busy port fails fast. |
| `bun run build` | Vite build, then copies `src/lib/db/migrations` → `build/server/migrations`. |
| `bun run start` | Serve the production build (`NODE_ENV=production bun ./build/index.js`). |
| `bun run check` | Biome lint + format only — **not** a type check. |
| `bunx tsc --noEmit` | Type check. Not a package script; defined only in `prek.toml`. |
| `bunx svelte-check --threshold warning` | Svelte/template check. Also prek-only. |
| `bun run test` | Vitest suite (`e2e/**` excluded). |
| `bunx vitest run src/lib/crypto/__tests__/keys.test.ts` | Single test file. |
| `bunx vitest run <file> -t "substring"` | Single test case. |
| `bun run test:e2e` | Playwright: rebuilds, seeds a temp SQLite DB, boots a prod server on 4173. Slow. |
| `bunx playwright test --project=app` | One Playwright project; its `setup` → `auth` dependencies still run. |

`OTPRAVKARR_SECRET` must be set before the server starts — `validateEnv()` calls
`process.exit(1)` when it is missing or too weak. Generate with `openssl rand -base64 32`.

## Architecture

`src/hooks.server.ts` is the spine: `sequence(requestLogger, localsInit, runtimeInit, setupGate,
sessionResolver, csrfValidator, securityHeaders)`. `runtimeInit` memoizes all startup work on the
first request — env validation, migrations, scheduler job registration, first-run bootstrap-token
banner. There is no separate bootstrap entrypoint.

- `src/lib/bridge/` — domain layer, and where behavioural changes usually belong: provisioning
  (`provisioner.ts`), enable/disable/rotate (`lifecycle.ts`), channel-group access
  (`subscriptions.ts`, `group-profiles.ts`), periodic reconcile (`reconcile.ts`,
  `subscription-sync.ts`, `quarantine-sync.ts`). Routes and scheduler jobs orchestrate it; they do
  not re-implement it.
- `src/lib/dispatcharr/` — `client.ts`, per-area `endpoints/*.ts`, Zod `schemas.ts`
  (passthrough-tolerant; the real API returns more fields than are modelled), `plugins/`. Every
  endpoint returns `DispatcharrResult<T>` (`{ok:true,data}` | `{ok:false,error,message,retryable?}`)
  and never throws.
- `src/lib/db/` — `connection.ts` owns the lazy singleton `Database` (WAL, `foreign_keys=ON`) behind
  a `db` Proxy; `repositories/*.ts` hold all SQL; `migrate.ts` applies `migrations/*.sql`.
- `src/lib/crypto/` — HKDF derives a per-purpose AES-256-GCM key from `OTPRAVKARR_SECRET`. Purposes
  in use: `config-encryption`, `credential-encryption`.
- `src/lib/components/ui/**` is shadcn-svelte registry code (`components.json`); app components live
  directly in `src/lib/components/`.

Routes: `(admin)` operator panel, `(portal)` Plex-user portal, `/setup` one-time wizard gated by
`setupGate`, `/api/health` public, `/api/internal/*` session-required (401 without one, plus
Fetch-Metadata and origin checks in `csrfValidator`).

## Choosing the right primitive

| Situation | Use | Not |
|---|---|---|
| Dispatcharr call in an admin page load or connection test | `createInteractiveClient(url, key)` | the default constructor — its 15s timeout outlives the adapter's `IDLE_TIMEOUT`, so the socket is severed before a degraded state can render |
| Dispatcharr call from a scheduler job, portal credential path, or mutation | `new DispatcharrClient(url, key)` (15s + idempotent retry) | the interactive client (no retries, sub-idle timeout) |
| Multi-call interactive load | wrap the aggregate in `withDeadline()` (`$lib/utils/deadline`) | per-call timeouts alone |
| Retrying a Dispatcharr call | `retryResult(fn, isTransientResultError)` (`$lib/utils/retry`) | hand-rolled loops |
| Any database access | a function in `src/lib/db/repositories/` using the shared `db` | `new Database(...)` — WAL, foreign keys, and the migration gate are centralized in `connection.ts` |
| Persisting a secret or setting | `setConfig(key, value, true)` | raw SQL against `config`, which bypasses encryption and cache invalidation |
| Guarding a route | `requireAdmin` (page, redirects), `requireAdminApi` (JSON 401/403), `requireUser` (portal) | inspecting `event.locals.admin` directly |
| Shared client-side reactive state | export a `$state` object from `src/lib/state/*.svelte.ts` and mutate its properties | reassigning the exported binding (breaks reactivity across importers) |

`(admin)/+layout.server.ts` calls `requireAdmin`, but layout `load` does not run for form actions or
`+server.ts` handlers — every action and endpoint guards itself as well.

## Conventions

- **Server tests must declare `// @vitest-environment node` as their first line.**
  `vitest.config.ts` sets jsdom globally because component tests depend on it; over half the suite
  carries the pragma, and omitting it on a server test produces confusing jsdom failures.
- Two test locations, both intentional: `src/lib/**/__tests__/*.test.ts` (excluded from `tsconfig`)
  and route tests colocated as `page.server.test.ts` / `page.svelte.test.ts` (type-checked).
- **No inline `style="…"` in Svelte templates** — the CSP in `svelte.config.ts` sets
  `style-src: self` with no `unsafe-inline`, and the codebase has zero occurrences. Put dynamic
  values in a component `<style>` block (SvelteKit auto-nonces it) or drive them from
  data-attribute CSS rules.
- TypeScript is strict plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and
  `verbatimModuleSyntax`: use `import type`, and declare optional interface fields as
  `x?: T | undefined`.
- Biome deliberately disables `noExplicitAny` and `noUnusedVariables`; `organizeImports` is on, so
  let `bun run format` order imports.
- Conventional Commits are enforced by prek's `conventional-pre-commit`, and prek's
  `no-commit-to-branch` blocks committing directly to `main`.

## Change recipes

**Database migration** — add `src/lib/db/migrations/NNN_name.sql`; the runner only accepts
`^(\d+)_(.+)\.sql$` and warns-and-skips anything else. Use plain `ALTER TABLE … ADD COLUMN` (each
migration runs exactly once, and SQLite has no `IF NOT EXISTS` for columns) and
`CREATE TABLE IF NOT EXISTS` for new tables — see `003_lineup_policies.sql`. Update the row
interface in `src/lib/db/types.ts` and its repository. If the column is encrypted, mirror it in
`scripts/rotate-key.ts`.

**Dispatcharr API call** — schema in `dispatcharr/schemas.ts`, function in
`dispatcharr/endpoints/<area>.ts` returning `client.request<T>(method, path, { schema })`, test in
`dispatcharr/__tests__/`.

**Dispatcharr plugin adapter** — add `dispatcharr/plugins/adapters/<key>.ts` and append it to
`pluginAdapters` in `plugins/registry.ts`. Plugins with no registered adapter still surface via a
generic fallback, so a forgotten registration fails silently rather than loudly.

## Gotchas

- **`OTPRAVKARR_SECRET` is the root of all encryption.** Changing it orphans every encrypted
  column. Rotate with `OLD_SECRET=<old> NEW_SECRET=<new> bun scripts/rotate-key.ts`, which
  re-encrypts in place. That script deliberately re-implements HKDF/AES standalone (no SvelteKit
  imports), so any new encryption purpose or encrypted column must be mirrored there or rotation
  silently skips it.
- **In production, `getDb()` throws when a configured `DATABASE_PATH` does not exist** rather than
  creating a fresh database. That guard prevents silent data loss on a missing volume mount — fix
  the mount, do not remove the check.
- **Never leave a Dispatcharr user with an empty `channel_profiles` set** — Dispatcharr reads that
  as "full catalog". `applyGroupSubscription` enforces scope (falling back to the shared empty
  profile for a zero-group selection), and both the create and reactivate paths in `provisioner.ts`
  delete the remote user when enforcement fails. Preserve that rollback.
- **E2E runs against a real production build**: `playwright.config.ts` rebuilds, seeds a temp SQLite
  file via `e2e/seed-db.ts`, and sets `NODE_ENV=production` with `reuseExistingServer: false`. Use
  the `storageState` produced by `auth.setup.ts` instead of calling `loginAsAdmin()` per test — the
  login limiter allows 5 attempts per 5 minutes.
- `src/lib/test-stubs/` holds Vitest-only aliases for `$app/forms`, `$app/navigation`, `$app/state`
  (wired in `vitest.config.ts`). Never import them from production code; extend them when a test
  needs a new `$app` API.
- There is no Dockerfile and no `.github/` workflows here — container packaging lives in
  `engels74/otpravkarr-docker`, and all validation is local via `prek.toml`. `data/`, `docs/`, and
  `artifacts/` are gitignored runtime paths.

## Reference

- `.agents/rules/bun-svelte-pro.md` — long-form Bun / Svelte 5 runes / SvelteKit 2 / UnoCSS /
  shadcn-svelte conventions. Read before authoring new components or SvelteKit boilerplate.
- `README.md` — environment variables, the first-run bootstrap-token flow, the production
  checklist, and both `/api/health` response shapes. Read before changing setup, deployment, or
  health output.
