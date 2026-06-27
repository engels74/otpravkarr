# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Otpravkarr is a SvelteKit 2 + Bun app that provisions Plex friends into Dispatcharr as IPTV (Xtream Codes) users and serves a per-user portal for retrieving credentials. It runs as a single Bun process with SQLite via `bun:sqlite` and in-process scheduled jobs. AGPL-3.0.

Where things live (`src/`):

- `routes/(admin)/*` — admin UI (dashboard, users, settings, audit); gated by `requireAdmin`.
- `routes/(portal)/*` — end-user portal (Plex OAuth login + credential/URL retrieval).
- `routes/setup/*` — first-run wizard, gated by `setupGate` in `hooks.server.ts`.
- `routes/login/*` — admin login form action; `routes/api/internal/*` — admin JSON endpoints; `routes/api/health/*` — unauthenticated coarse health.
- `lib/db/` — `bun:sqlite` singleton + migration runner + `repositories/*` (admin, audit, config, sessions, users) + `types.ts` (`AuditAction`).
- `lib/bridge/` — orchestration across Plex + Dispatcharr + DB: `provisioner.ts`, `lifecycle.ts`.
- `lib/dispatcharr/` — typed ofetch client (`client.ts`) returning `DispatcharrResult<T>`, plus `endpoints/*` (Zod-validated).
- `lib/plex/` — `@ctrl/plex` wrappers (`client.ts`, `oauth.ts`, `friends.ts`); throws `PlexAuthError` / `PlexConnectionError`.
- `lib/scheduler/` — `runner.ts` (singleton `Scheduler`) + `jobs/*` (sync, health, cleanup, audit-rotation).
- `lib/server/` — server-only helpers: `auth.ts`, `csrf.ts`, `env.ts`, `logging.ts`, `plex-owner.ts`, `validation.ts`.
- `lib/crypto/` — `bootstrap`, `encryption`, `passwords`, `keys`, `secret`.
- `src/hooks.server.ts` — single source of startup wiring and the `handle` middleware chain.

## Commands

Run all commands from the repo root.

```bash
bun install                                      # install deps
bun --bun run dev                                # dev server; fails fast if PORT (default 3000) is in use
bun --bun run build                              # vite build + copy src/lib/db/migrations → build/server/migrations
bun ./build/index.js                             # run built server (svelte-adapter-bun); `bun --bun run start` is an alias
bun run check                                    # biome lint + format check
bun run format                                   # biome format --write .
bun run test                                     # vitest run (jsdom; excludes e2e/)
bun run test:e2e                                 # playwright (builds, seeds, serves on :4173)
bunx vitest run <path/to/file.test.ts>           # single unit test file
bunx vitest run -t "<test name fragment>"        # single unit test by name
bunx playwright test <spec.spec.ts>              # single e2e spec
bunx svelte-check --threshold warning            # svelte type/template diagnostics
bunx tsc --noEmit                                # strict TS check
```

There is no `package.json` script for type/svelte checks — invoke `bunx tsc --noEmit` and `bunx svelte-check` directly. `prek` runs `biome-check`, `svelte-check`, and `tsc --noEmit` as pre-commit gates (`prek.toml`).

`OTPRAVKARR_SECRET` (>= 32 random bytes, base64) must be set before `dev`/`start`. On first run a single-use bootstrap token prints to the console; complete the wizard at `/setup`. See `README.md` for the full env-var table (`DATABASE_PATH`, `HOST`, `PORT`, `ORIGIN`).

## Architecture

- **Startup (`src/hooks.server.ts`).** Runtime init is lazy-once: `validateEnv()`, `initializeDatabase()` (runs SQL migrations in one transaction), `registerSchedulerJobs()`, `printBootstrapBanner()`, `markServerStarted()`. The `handle` sequence is `requestLogger → localsInit → runtimeInit → setupGate → sessionResolver → csrfValidator → securityHeaders`.
- **Setup gate.** Until `config.setup_completed = "true"`, every non-`/setup`, non-static, non-`/api/health` request redirects to `/setup`. Don't bypass without updating `setupGate`.
- **Auth.** One cookie `otpravkarr_session` (`SESSION_COOKIE_NAME`) holds either an admin or user session row. Use `requireAdmin(event)` (303 → `/login`) / `requireAdminApi(event)` (401) / `requireUser(event)` from `$lib/server/auth.ts`. TTLs: admin 1h, user 4h. `sessionResolver` puts only **active** mappings in `locals.user`; revoked mappings go to `locals.revokedUser`.
- **Database.** Single SQLite file at `DATABASE_PATH` (default `./data/otpravkarr.sqlite`), WAL + `foreign_keys=ON`. Access via the lazy `db` proxy or `getDb()` (`$lib/db/connection.ts`). Migrations are `src/lib/db/migrations/NNN_name.sql`, applied in order on first DB access; `resolveMigrationsDir()` finds them in dev and production.
- **Bridge.** All Plex↔Dispatcharr↔DB orchestration lives in `$lib/bridge` (`provisionUser`, `disableUser`, `enableUser`, `rotateCredentialsForMappingId`, `reconcileSync`). Routes and jobs call into it rather than re-implementing the flow.
- **Dispatcharr client.** `client.request(method, path, { body, schema })` returns `DispatcharrResult<T>` — a `{ ok: true, data }` / `{ ok: false, error, message, retryable? }` union. It never throws on HTTP errors; check `result.ok`.
- **Scheduler.** `scheduler.register({ name, interval, fn })`; re-registering the same `name` replaces the job. Job `fn`s are self-contained (own try/catch, own audit writes); the runner logs but does not retry.
- **CSP.** Defined in `svelte.config.ts`; `style-src`/`script-src` are `self` only. No inline `style="..."` or scripts.

## Key workflows

**Add a SQL migration.** 1) Create `src/lib/db/migrations/NNN_name.sql` (next zero-padded integer; runner skips files not matching `^(\d+)_(.+)\.sql$`). 2) Prefer idempotent SQL (`CREATE TABLE IF NOT EXISTS`); the whole set runs in one transaction. 3) Update `$lib/db/types.ts` and affected `$lib/db/repositories/*`. 4) Restart dev (migrations run on first DB access). 5) Verify `bun --bun run build` still copies the file into `build/server/migrations/`.

**Add an admin form action.** 1) In a `+page.server.ts` under `routes/(admin)/`, start `load`/each action with `await requireAdmin(event)`. 2) Validate with a Zod schema via `parseFormData(formData, Schema)` (runs `sanitizeString`); `fail(400, …)` on error. 3) Call into `$lib/bridge/*` for cross-system effects. 4) Record via `appendAuditLog({ actor, action: AuditAction.X, detail, ipAddress })`.

**Add an admin JSON endpoint.** 1) `routes/api/internal/<name>/+server.ts` exporting `GET`/`POST`. 2) First line `await requireAdminApi(event)` (401, not redirect). 3) Return `Response.json(...)`, matching the sibling `{ ok: false, error }` error shape.

**Add a Dispatcharr endpoint helper.** Add a function to `lib/dispatcharr/endpoints/<resource>.ts` taking `client: DispatcharrClient` first, pass a Zod `{ schema }` to `client.request`, and return `DispatcharrResult<T>` — do not throw.

**Add a scheduled job.** Create `lib/scheduler/jobs/<name>.ts` exporting `createXJob()` returning `{ name, interval, fn }`, then register it in `registerSchedulerJobs()` in `src/hooks.server.ts`.

## Decision guide

| Situation | Use this | Avoid |
| --- | --- | --- |
| Server-side input validation | Zod schema + `parseFormData` / `safeParse` (`$lib/server/validation.ts`) | Ad-hoc `String(formData.get(...))` chains |
| Dispatcharr HTTP call | `DispatcharrClient.request` / `endpoints/*`, checking `result.ok` | Calling `ofetch`/`fetch` directly or throwing |
| Plex API call | `$lib/plex/*` helpers; catch `PlexAuthError` / `PlexConnectionError` | Importing `@ctrl/plex` directly in routes |
| Provision/enable/disable/rotate/sync | `$lib/bridge/{provisioner,lifecycle}.ts` | Re-implementing the multi-system flow in a route/job |
| New SQLite query | Exported prepared-statement function in `$lib/db/repositories/*` | Inlining `db.prepare(...)` in routes |
| Encrypting secrets at rest | `encrypt(value, purpose)` / `decrypt(...)` (`$lib/crypto/encryption.ts`); store in `_enc` columns | Plaintext or new ad-hoc crypto |
| Retrying a Plex/Dispatcharr call | `retryAsync` / `retryResult` + matching `isTransient*` (`$lib/utils/retry.ts`) | Manual loops without classifying transient failures |
| Inline styling | UnoCSS classes or scoped `<style>` blocks | `style="..."` attributes (blocked by CSP) |

## Code patterns

Dispatcharr Result handling (`src/lib/dispatcharr/endpoints/users.ts` style):

```ts
const result = await client.request("PATCH", `/api/accounts/users/${id}/`, { body, schema: DispatcharrUserSchema });
if (!result.ok) return fail(502, { error: result.error, message: result.message });
const user = result.data;
```

Audit log + repository pattern:

```ts
appendAuditLog({
  actor: admin.username,
  action: AuditAction.USER_DISABLED,
  detail: { mappingId: id },
  ipAddress: event.getClientAddress(),
});
```

## Project-specific rules

- Run dev/build/start under Bun (`bun --bun run dev|build`, `bun ./build/index.js`). Plain `vite` skips the migrations-copy step the runtime needs.
- The `build` script copies `src/lib/db/migrations` → `build/server/migrations`. If you reorganize the migrations dir, update the script too.
- Don't `throw` for expected Dispatcharr failures — return/propagate `DispatcharrResult`. Bridge functions assume that shape.
- Store credentials/tokens via `$lib/crypto/encryption.ts`; the DB column convention is the `_enc` suffix. Master key is `OTPRAVKARR_SECRET`.
- Config reads go through `$lib/db/repositories/config.ts:getConfig` (cached). After writing config, call `invalidateConfigCache()` and re-register affected jobs (see `routes/(admin)/settings/+page.server.ts`).
- Exclude the configured Plex owner via `$lib/server/plex-owner.ts` (`excludePlexOwnerMappings`); don't filter owner accounts manually.
- No inline `style="..."` — CSP `style-src` is `self`. Use UnoCSS classes or scoped `<style>`.
- TS is strict with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`, `verbatimModuleSyntax`. Annotate `catch (error: unknown)` and narrow before use.
- Biome owns formatting and import ordering (2 spaces, width 100). Run `bun run check` before committing; don't reorder imports by hand.
- Vitest aliases `$app/*` to `src/lib/test-stubs/*`. Prefer those stubs over inventing new SvelteKit mocks. E2E must run against the built server (`playwright.config.ts`, port 4173), not `dev`.

## References

- `.augment/rules/bun-svelte-pro.md` — read before non-trivial Svelte 5 / SvelteKit 2 / UnoCSS / shadcn-svelte work.
- `README.md` — env vars, Docker deploy, `/api/health` and `/api/internal/health` payloads.
- `playwright.config.ts` — E2E project chain (`setup → auth → login/app/portal`) and the server env.
- `svelte.config.ts` — adapter options and the full CSP directive set; `prek.toml` — exact pre-commit gates.
