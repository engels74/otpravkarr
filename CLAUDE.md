# CLAUDE.md

This file provides guidance to AI coding agents when working in this repository.

## Project overview

Otpravkarr is a SvelteKit 2 + Bun app that provisions Plex friends into Dispatcharr as IPTV (Xtream Codes) users and exposes a per-user portal for retrieving their credentials. Single Bun process, SQLite via `bun:sqlite`, scheduled background jobs in-process.

Where things live (`src/`):

- `routes/(admin)/*` — admin UI (dashboard, users, settings, audit). Behind `requireAdmin`.
- `routes/(portal)/*` — end-user portal (Plex OAuth login + credential/URL retrieval).
- `routes/setup/*` — first-run wizard, gated by `setupGate` in `hooks.server.ts`.
- `routes/login/*` — admin login form action.
- `routes/api/internal/*` — admin-authenticated JSON endpoints (`health`, `plex-friends`, `rotate-credentials`, `signout`, `sync`).
- `routes/api/health/*` — unauthenticated coarse health.
- `lib/db/` — `bun:sqlite` singleton, migration runner, `repositories/*` (admin, audit, config, sessions, users), `types.ts` (incl. `AuditAction` const enum).
- `lib/bridge/` — orchestration between Plex + Dispatcharr + local DB. `provisioner.ts` creates/reactivates mappings; `lifecycle.ts` handles enable/disable/rotate/`reconcileSync`.
- `lib/dispatcharr/` — typed HTTP client (`client.ts`, ofetch-based, returns `DispatcharrResult<T>`) and per-resource `endpoints/*` modules with Zod schemas.
- `lib/plex/` — `@ctrl/plex` wrappers (`client.ts`, `oauth.ts`, `friends.ts`); throws `PlexAuthError` / `PlexConnectionError`.
- `lib/scheduler/` — `runner.ts` (singleton timer scheduler) and `jobs/*` (sync, health, cleanup, audit-rotation).
- `lib/server/` — server-only helpers: `auth.ts`, `csrf.ts`, `env.ts`, `logging.ts`, `origins.ts`, `plex-owner.ts`, `ratelimit.ts`, `validation.ts` (Zod schemas + `sanitizeString` + `parseFormData`).
- `lib/crypto/` — `bootstrap` token, `encryption` (envelope), `passwords` (Bun.password).
- `lib/components/ui/*` — shadcn-svelte primitives. App components live in `lib/components/*`.
- `src/hooks.server.ts` — single source of startup wiring: env validation, DB init/migrate, scheduler job registration, setup gate, CSRF, session attach, logging.

## Commands

Run all commands from the repo root.

```bash
bun install                       # install deps
bun --bun run dev                 # dev server, fails fast if PORT (default 3000) is in use
bun --bun run build               # vite build + copy src/lib/db/migrations → build/server/migrations
bun ./build/index.js              # run built server (svelte-adapter-bun)
bun --bun run start               # alias for the above
bun run check                     # biome lint + format check
bun run format                    # biome format --write .
bun run test                      # vitest run (unit, jsdom; excludes e2e/)
bun run test:e2e                  # playwright (builds, seeds DB, launches server on 4173)
bunx vitest run path/to/file.test.ts             # single unit test file
bunx vitest run -t "test name fragment"          # single unit test by name
bunx playwright test admin-users.spec.ts         # single e2e spec
bunx svelte-check --threshold warning            # svelte type/template diagnostics
bunx tsc --noEmit                                # strict TS check
```

`prek` runs `biome-check`, `svelte-check`, and `tsc --noEmit` as pre-commit hooks (`prek.toml`). There is no `package.json` script for typecheck/svelte-check — invoke them directly.

A `OTPRAVKARR_SECRET` (>=32 random bytes, base64) must be set before `dev`/`start`. The dev server prints a bootstrap token on first run; complete the setup wizard at `/setup` to use the app.

## High-level architecture

- **Startup (`src/hooks.server.ts`).** Runtime init is lazy-once: `validateEnv()`, `initializeDatabase()` (runs SQL migrations inside a single transaction), `registerSchedulerJobs()` (sync, health, cleanup, audit-rotation), `printBootstrapBanner()`, `markServerStarted()`. The `handle` sequence is `localsInit → runtimeInit → setupGate → originCheck → csrfCheck → sessionAttach → loggingHandle`.
- **Setup gate.** Until `config.setup_completed = "true"`, every non-`/setup`, non-static, non-`/api/health` request 303s to `/setup`. Don't bypass this without updating `setupGate`.
- **Auth.** Single cookie `otpravkarr_session` holds either an admin or user session row (`sessions.session_type`). Use `requireAdmin(event)` / `requireAdminApi(event)` / `requireUser(event)` from `$lib/server/auth.ts`. Admin sessions live 1h; user sessions 4h. `requireAdmin*` redirect (303 → `/login`) or error 401 for API.
- **Database.** Single SQLite file at `DATABASE_PATH` (default `./data/otpravkarr.sqlite`), WAL + `foreign_keys=ON`. Access via the lazy `db` proxy or `getDb()` from `$lib/db/connection.ts`. Migrations are `src/lib/db/migrations/NNN_name.sql`, applied in order on first DB access; the build script copies them next to the bundled server so production resolves them via `resolveMigrationsDir()`.
- **Bridge layer.** All Plex↔Dispatcharr↔DB orchestration lives in `$lib/bridge`. Routes and jobs should call into it (`provisionUser`, `disableUser`, `enableUser`, `rotateCredentialsForMappingId`, `reconcileSync`) rather than re-implementing the logic.
- **Dispatcharr client.** `new DispatcharrClient(url, apiKey)` then `client.request(method, path, { body, schema })` or use a helper in `$lib/dispatcharr/endpoints/*`. Result type is `DispatcharrResult<T>` — a `{ ok: true, data }` / `{ ok: false, error, message, retryable? }` discriminated union. Never throws on HTTP errors; check `result.ok`.
- **Plex client.** `$lib/plex/client.ts` wraps `@ctrl/plex` and throws `PlexAuthError` / `PlexConnectionError`. `$lib/plex/oauth.ts` holds an in-memory pending/completed OAuth map. `$lib/plex/friends.ts` has a 15-min in-process cache.
- **Scheduler.** `scheduler.register({ name, interval, fn })` from `$lib/scheduler/runner.ts`. Re-registering by the same `name` replaces the existing job. Job functions must be self-contained (own try/catch, own audit log writes); the runner logs but does not retry.
- **CSP.** Defined in `svelte.config.ts`. No inline styles or scripts — put dynamic styling in component `<style>` blocks or data-attribute-driven CSS rules.

## Task workflows

### Add an admin form action

1. Create or edit a `+page.server.ts` under `routes/(admin)/.../`.
2. Start `load`/each action with `await requireAdmin(event)`.
3. Define a Zod schema in `$lib/server/validation.ts` (or alongside) and parse with `parseFormData(formData, Schema)` — it runs `sanitizeString` per field. Return `fail(400, …)` on validation failure.
4. Call into `$lib/bridge/*` for cross-system effects; never call Dispatcharr/Plex APIs directly from a route when bridge logic already covers it.
5. Append an `AuditAction.*` entry via `appendAuditLog({ actor, action, detail, ipAddress })`.

### Add an admin JSON endpoint

1. Create `routes/api/internal/<name>/+server.ts` exporting `GET`/`POST`/etc.
2. First line: `await requireAdminApi(event)` (throws 401 instead of redirecting).
3. Return `Response.json(...)`. Match the existing error shape `{ ok: false, error: "…" }` used by sibling endpoints.

### Add a SQL migration

1. Create `src/lib/db/migrations/NNN_name.sql` where `NNN` is the next zero-padded integer after `001_initial.sql`. The runner skips files that don't match `^(\d+)_(.+)\.sql$`.
2. Write idempotent-friendly SQL where possible (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN`). The whole migration set runs inside one transaction.
3. Update `$lib/db/types.ts` and any affected repository in `$lib/db/repositories/*` (prepared statements are lazy and cached per module).
4. Restart the dev server — migrations run on first DB access via `initializeDatabase()`.
5. Verify `bun --bun run build` still produces `build/server/migrations/NNN_name.sql` (the build script copies the folder; new files are picked up automatically).

### Add a Dispatcharr endpoint helper

1. Add a function to `src/lib/dispatcharr/endpoints/<resource>.ts` taking `client: DispatcharrClient` first.
2. Define a Zod schema (often in `src/lib/dispatcharr/schemas.ts`) and pass it as `{ schema }` to `client.request` so responses are validated.
3. Return `DispatcharrResult<T>` — do not throw. Callers `if (!result.ok) …` on it.
4. For paginated endpoints, wrap with `paginatedSchema(...)` and handle the flat-array fallback used in `endpoints/users.ts:listUsers`.

### Add a scheduled background job

1. Create `src/lib/scheduler/jobs/<name>.ts` exporting `createXJob(intervalMs?)` that returns `{ name, interval, fn }`.
2. Inside `fn`, read config via `getConfig(...)`, do work, write `appendAuditLog(...)` entries for visible events, and `console.log(JSON.stringify({ ... }))` for structured ops logs (match the format used by `jobs/sync.ts`).
3. Register it in `registerSchedulerJobs()` in `src/hooks.server.ts`. Job names are unique keys — re-registering replaces a running job.

### Add a Plex-facing feature

Reuse `$lib/plex/client.ts` (`getAccount`, `validateServerToken`, `checkServerHealth`, `discoverServers`, `getServerResources`) and `$lib/plex/friends.ts` (`fetchFriends` populates the shared cache; `getCachedFriends()` reads it). Wrap calls in `retryAsync` / `isTransientPlexError` from `$lib/utils/retry.ts` for transient failures.

## Decision tables

| Situation | Use this | Avoid |
| --- | --- | --- |
| Server-side input validation | Zod schema in `$lib/server/validation.ts` + `parseFormData` / `safeParse` | Ad-hoc `String(formData.get(...))` chains in routes |
| Dispatcharr HTTP call | `DispatcharrClient.request` or an `endpoints/*` helper, checking `result.ok` | Calling `ofetch`/`fetch` directly, or `throw`-style error handling |
| Plex API call | `$lib/plex/client.ts` / `oauth.ts` / `friends.ts` helpers; catch `PlexAuthError` / `PlexConnectionError` | Importing `@ctrl/plex` directly in routes |
| Plex+Dispatcharr+DB orchestration (provision, enable, disable, rotate, sync) | `$lib/bridge/{provisioner,lifecycle}.ts` | Re-implementing the multi-system flow in a route or job |
| New SQLite query | New prepared statement + exported function in `$lib/db/repositories/*.ts` | Inlining `db.prepare(...)` in routes/services |
| Audit-worthy event | `appendAuditLog({ action: AuditAction.X, … })` with an `AuditAction` constant | Free-form strings (the audit page filters on the known constants) |
| Shared, recurring side effect | New scheduler job + registration in `hooks.server.ts` | Top-level `setInterval` outside the runner (timers get lost on hot reload, no overlap guard) |
| Admin gating in `+page.server.ts` | `requireAdmin(event)` | Inline cookie/session checks |
| Admin gating in `+server.ts` (JSON API) | `requireAdminApi(event)` (returns 401) | `requireAdmin` (redirects, breaks API clients) |
| Encrypting credentials at rest | `$lib/crypto/encryption.ts` (envelope tied to `OTPRAVKARR_SECRET`) | Storing plaintext / new ad-hoc crypto |
| Retrying a Plex/Dispatcharr call | `retryAsync` / `retryResult` from `$lib/utils/retry.ts` with the matching `isTransient*` predicate | Manual loops without classifying transient vs permanent failures |
| Inline styling | UnoCSS classes; component `<style>` for dynamic CSS custom properties | `style="..."` attributes (blocked by CSP) |

## Code patterns and examples

Dispatcharr call with Result handling (`src/lib/dispatcharr/endpoints/users.ts` style):

```ts
const result = await client.request("PATCH", `/api/accounts/users/${id}/`, {
  body: data,
  schema: DispatcharrUserSchema,
});
if (!result.ok) {
  return fail(502, { error: result.error, message: result.message });
}
const user = result.data;
```

Form action skeleton (`src/routes/login/+page.server.ts`):

```ts
const result = LoginSchema.safeParse({
  username: sanitizeString(String(formData.get("username") ?? "")),
  password: String(formData.get("password") ?? ""),
});
if (!result.success) return fail(400, { error: "missing_credentials" });
```

Scheduler job shape (`src/lib/scheduler/jobs/sync.ts`):

```ts
return {
  name: "plex-dispatcharr-sync",
  interval: intervalMs,
  fn: async () => {
    /* read config, do work, appendAuditLog on outcomes, never throw past here */
  },
};
```

Audit log + repository pattern:

```ts
import { appendAuditLog } from "$lib/db/repositories/audit";
import { AuditAction } from "$lib/db/types";

appendAuditLog({
  actor: admin.username,
  action: AuditAction.USER_DISABLED,
  detail: { mappingId: id },
  ipAddress: event.getClientAddress(),
});
```

## Project-specific rules

- Run dev/build/start under the Bun runtime: `bun --bun run dev`, `bun --bun run build`, `bun ./build/index.js`. Plain `vite` won't produce the migrations-copy step needed at runtime.
- Migrations are bundled by a `cp -r src/lib/db/migrations build/server/migrations` step in the `build` script. If you reorganize `src/lib/db/migrations/`, update the build script too.
- Don't `throw` for expected Dispatcharr API failures — return / propagate `DispatcharrResult`. Bridge functions assume the Result shape.
- Catch `PlexAuthError` and `PlexConnectionError` separately at route boundaries; they map to distinct user-facing outcomes (re-auth vs. retry).
- Store credentials and tokens encrypted via `$lib/crypto/encryption.ts`; the DB column convention is the `_enc` suffix (e.g. `dispatcharr_xc_password_enc`). The master key is `OTPRAVKARR_SECRET`.
- Every Plex/Dispatcharr config read goes through `$lib/db/repositories/config.ts:getConfig`, which is cached. After writing config, call `invalidateConfigCache()` and re-register affected scheduler jobs (see `routes/(admin)/settings/+page.server.ts` for the pattern).
- Excluding the configured Plex owner from user mappings is done via `$lib/server/plex-owner.ts` (`excludePlexOwnerMappings`, `tryResolveConfiguredPlexOwnerAccountId`). Don't filter owner accounts manually in routes.
- No inline `style="..."` — CSP `style-src` is `self` only. Use UnoCSS classes or scoped `<style>` blocks (SvelteKit auto-nonces them).
- TS is strict with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`, `verbatimModuleSyntax`. Annotate `catch (error: unknown)` and narrow before use.
- Biome handles formatting and import ordering (2 spaces, width 100). Run `bun run check` before committing; don't reorder imports by hand.
- Vitest configures `$app/*` stubs (`src/lib/test-stubs/*`). When importing SvelteKit runtime helpers in code that is unit-tested, prefer the existing stubs over inventing new mocks.
- E2E tests must run against the built server (`playwright.config.ts` builds, seeds, then launches on port 4173). Don't try to run them against `bun --bun run dev`.

## References

- `.augment/rules/bun-svelte-pro.md` — read before non-trivial Svelte 5 / SvelteKit 2 / UnoCSS / shadcn-svelte work. Long but authoritative on runes-era patterns used here.
- `README.md` — environment variables, Docker deploy, public `/api/health` and `/api/internal/health` payload shapes.
- `playwright.config.ts` — projects (`setup` → `auth` → `login`/`app`/`portal`) and the env the E2E server runs with.
- `prek.toml` — exact commands that run as pre-commit gates (`biome-check`, `svelte-check`, `tsc --noEmit`).
- `svelte.config.ts` — adapter options and the full CSP directive set.
