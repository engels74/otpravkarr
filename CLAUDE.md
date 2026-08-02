# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Otpravkarr provisions Plex users into Dispatcharr (IPTV) and serves each user their own
credentials/playlist. Bun + SvelteKit 2 + Svelte 5 runes + `bun:sqlite`, deployed via
`svelte-adapter-bun`.

## Essential Commands

Run everything from the repository root. `bun install` first; `.npmrc` sets `engine-strict=true`.

| Command | Purpose |
|---|---|
| `bun run dev` | Dev server (script already passes `--bun`). Binds `PORT` (default 3000) with `strictPort: true`, so a busy port fails fast. |
| `bun run build` | Vite build, then copies `src/lib/db/migrations` → `build/server/migrations`. |
| `bun run start` | Serve the production build (`NODE_ENV=production bun ./build/index.js`). |
| `bun run check` | Biome lint + format check (there is no separate `lint` script). |
| `bun run format` | Biome write-mode formatting. |
| `bunx tsc --noEmit` | Type-check. Not a package script — it runs via `prek.toml`. |
| `bunx svelte-check --threshold warning` | Svelte/template type-check. Also prek-only. |
| `bun run test` | Full Vitest suite (`e2e/**` excluded). |
| `bunx vitest run src/lib/crypto/__tests__/keys.test.ts` | Single test file. |
| `bunx vitest run <file> -t "substring"` | Single test case. |
| `bun run test:e2e` | Full Playwright suite (slow: rebuilds, seeds a temp DB, boots a prod server). |
| `bunx playwright test --project=app` | One Playwright project; dependencies (`setup` → `auth`) still run. |

`OTPRAVKARR_SECRET` must be set before starting the server — `validateEnv()` calls
`process.exit(1)` when it is missing or too weak. Generate with `openssl rand -base64 32`.

## Architecture Overview

`src/hooks.server.ts` is the spine: one `sequence()` of `requestLogger → localsInit → runtimeInit →
setupGate → sessionResolver → csrfValidator → securityHeaders`. `runtimeInit` lazily and memoizedly
performs all startup work on the first request — env validation, migrations, scheduler job
registration, and the first-run bootstrap-token banner. There is no separate bootstrap entrypoint.

Layers:

- **`src/lib/bridge/`** — the domain layer, and where behavioural changes usually belong. Handles
  provisioning (`provisioner.ts`), enable/disable/rotate (`lifecycle.ts`), channel-group access
  enforcement (`subscriptions.ts`, `group-profiles.ts`), and the periodic reconcile
  (`reconcile.ts`, `subscription-sync.ts`, `quarantine-sync.ts`). Routes and jobs orchestrate it;
  they should not re-implement it.
- **`src/lib/dispatcharr/`** — HTTP client (`client.ts`), per-area endpoint modules
  (`endpoints/*.ts`), Zod schemas (`schemas.ts`), and plugin adapters (`plugins/`). Every endpoint
  returns `DispatcharrResult<T>` (`{ok:true,data}` | `{ok:false,error,message,retryable?}`) and
  never throws.
- **`src/lib/plex/`** — Plex OAuth, friends listing, client.
- **`src/lib/db/`** — `connection.ts` exposes a lazily-created singleton `Database` (WAL +
  `foreign_keys=ON`) through a `db` Proxy; `migrate.ts` applies `migrations/*.sql`;
  `repositories/*.ts` hold all SQL.
- **`src/lib/crypto/`** — HKDF derives a per-purpose AES-256-GCM key from `OTPRAVKARR_SECRET`.
  Purposes in use: `config-encryption`, `credential-encryption`.
- **`src/lib/scheduler/`** — in-process `scheduler` singleton running `sync`, `health`, `cleanup`,
  and `audit-rotation` jobs.

Route groups: `(admin)` is the operator panel, `(portal)` is the Plex-user-facing portal, `/setup`
is the one-time wizard gated by `setupGate`, `/api/health` is public, and `/api/internal/*` requires
a session (401 without one, plus Fetch-Metadata and origin checks in `csrfValidator`).

## Project Boundaries

- `src/lib/components/ui/**` — shadcn-svelte registry components (see `components.json`). App
  components live directly in `src/lib/components/`.
- `src/lib/test-stubs/` — Vitest-only aliases for `$app/forms`, `$app/navigation`, `$app/state`
  (wired in `vitest.config.ts`). Never import these from production code; extend them when a test
  needs a new `$app` API.
- No Dockerfile and no `.github/` workflows here. Container packaging lives in
  `engels74/otpravkarr-docker`; all validation is local via `prek.toml`.
- `data/`, `docs/`, and `artifacts/` are gitignored runtime/output paths.

## Common Change Workflows

**Add a database migration**
1. Create `src/lib/db/migrations/NNN_name.sql` — the runner only accepts `^(\d+)_(.+)\.sql$` and
   warns-and-skips anything else.
2. Use plain `ALTER TABLE ... ADD COLUMN` (each migration runs exactly once; SQLite has no
   `IF NOT EXISTS` for columns) and `CREATE TABLE IF NOT EXISTS` for new tables — see
   `003_lineup_policies.sql`.
3. Update the row interface in `src/lib/db/types.ts` and the matching repository.
4. If the column is encrypted, add it to `scripts/rotate-key.ts` too (see Critical Gotchas).

**Add a Dispatcharr API call**
1. Add a Zod schema in `src/lib/dispatcharr/schemas.ts` (schemas are passthrough-tolerant — the real
   API returns more fields than are modelled).
2. Add the function to `src/lib/dispatcharr/endpoints/<area>.ts`, returning
   `client.request<T>(method, path, { schema })`.
3. Add a test in `src/lib/dispatcharr/__tests__/`.

**Add a Dispatcharr plugin adapter**
Create `src/lib/dispatcharr/plugins/adapters/<key>.ts` and append it to `pluginAdapters` in
`plugins/registry.ts`. Plugins with no registered adapter still surface via a generic fallback, so a
missing registration fails silently rather than loudly.

**Add an admin page**
`src/routes/(admin)/<name>/+page.server.ts` (first line of `load`: `await requireAdmin(event)`) +
`+page.svelte`, plus colocated `page.server.test.ts` and `page.svelte.test.ts`.

## Implementation Decisions

| Situation | Preferred approach | Avoid |
|---|---|---|
| Dispatcharr call during an admin page load or connection test | `createInteractiveClient(url, key)` | the default constructor — its 15s timeout outlives the adapter's `IDLE_TIMEOUT`, so the socket is severed before a degraded state can render |
| Dispatcharr call from a scheduler job, portal credential path, or mutation | `new DispatcharrClient(url, key)` (15s + idempotent retry) | the interactive client (no retries, sub-idle timeout) |
| Multi-call interactive load | wrap the aggregate in `withDeadline()` (`src/lib/utils/deadline.ts`) | relying on per-call timeouts alone |
| Retrying a Dispatcharr call | `retryResult(fn, isTransientResultError)` (`src/lib/utils/retry.ts`) | hand-rolled loops |
| Any database access | a function in `src/lib/db/repositories/`, using the shared `db` from `connection.ts` | `new Database(...)` — WAL, foreign keys, and the migration gate are centralized there |
| Persisting a secret or setting | `setConfig(key, value, true)` | raw SQL against `config`, which bypasses encryption and the in-memory cache invalidation |
| Guarding a route | `requireAdmin` (page, redirects), `requireAdminApi` (JSON 401/403), `requireUser` (portal) | inspecting `event.locals.admin` directly |
| Shared client-side reactive state | export a `$state` object from `src/lib/state/*.svelte.ts` and mutate its properties | reassigning the exported binding (breaks reactivity across importers) |

## Repository Conventions

- **Server tests must declare `// @vitest-environment node` as their first line.** The global
  environment in `vitest.config.ts` is jsdom; component tests rely on that default. Roughly half the
  suite carries the pragma — omitting it on a server test produces confusing jsdom failures.
- Two test locations, both intentional: `src/lib/**/__tests__/*.test.ts` (excluded from `tsconfig`)
  and route tests colocated as `page.server.test.ts` / `page.svelte.test.ts` (type-checked).
- **No inline `style="..."` in Svelte templates** — the CSP in `svelte.config.ts` sets
  `style-src: self` with no `unsafe-inline`, and the codebase currently has zero occurrences. Put
  dynamic values in a component `<style>` block (SvelteKit auto-nonces it) or drive them from
  data-attribute CSS rules.
- TypeScript is strict with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and
  `verbatimModuleSyntax`: use `import type`, and declare optional interface fields as
  `x?: T | undefined`.
- Biome config deliberately disables `noExplicitAny` and `noUnusedVariables`; `organizeImports` is
  on, so let `bun run format` order imports.
- Conventional Commits are enforced by prek's `conventional-pre-commit`, and prek's
  `no-commit-to-branch` blocks committing directly to `main`.

## Critical Gotchas

- **`OTPRAVKARR_SECRET` is the root of all encryption.** Changing it orphans every encrypted column.
  To change it, run `OLD_SECRET=<old> NEW_SECRET=<new> bun scripts/rotate-key.ts`, which re-encrypts
  in place. That script deliberately re-implements HKDF/AES standalone (no SvelteKit imports), so
  any new encryption purpose or encrypted column must be mirrored there or rotation will silently
  skip it.
- **In production, `getDb()` throws if a configured `DATABASE_PATH` does not exist** rather than
  creating a fresh database. That guard prevents silent data loss on a missing volume mount — fix
  the mount, do not remove the check.
- **Provisioning must never leave a Dispatcharr user with an empty `channel_profiles` set** —
  Dispatcharr reads that as "full catalog". `applyGroupSubscription` enforces scope, and both the
  create and reactivate paths in `provisioner.ts` delete the remote user when enforcement fails.
  Preserve that rollback when touching those flows.
- **E2E runs against a real production build.** `playwright.config.ts` rebuilds, seeds a temp SQLite
  file via `e2e/seed-db.ts`, and sets `NODE_ENV=production` with `reuseExistingServer: false` on
  port 4173. Use the `storageState` produced by `auth.setup.ts` instead of calling `loginAsAdmin()`
  per test — the login rate limiter allows 5 attempts per 5 minutes.

## Additional Documentation

- `README.md` — environment variables, the first-run bootstrap-token flow, the production checklist,
  and both `/api/health` response shapes. Read before changing setup, deployment, or health output.
- `.augment/rules/bun-svelte-pro.md` — long-form Bun / Svelte 5 runes / SvelteKit 2 / UnoCSS /
  shadcn-svelte reference. Read when authoring new components or when unsure which rune pattern this
  stack expects.
</content>
</invoke>
