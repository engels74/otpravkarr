# CLAUDE.md

This file provides guidance to AI coding agents when working in this repository.

## Project overview

Otpravkarr bridges Plex user accounts to Dispatcharr (IPTV). It is a single SvelteKit 2 / Svelte 5 app served by `svelte-adapter-bun`, backed by `bun:sqlite`. There is no separate frontend/backend — all server logic runs inside SvelteKit hooks, route `+page.server.ts` files, and `/api` `+server.ts` files. Common change locations:

- Pages and form actions: `src/routes/(admin)/*`, `src/routes/(portal)/*`, `src/routes/setup/*`, `src/routes/login/*`
- Admin JSON API: `src/routes/api/internal/*` (admin-session-gated). Public health: `src/routes/api/health`
- Server-only logic: `src/lib/server/*`, `src/lib/db/*`, `src/lib/bridge/*`, `src/lib/dispatcharr/*`, `src/lib/plex/*`, `src/lib/scheduler/*`, `src/lib/crypto/*`
- Shared client state (Svelte 5 runes): `src/lib/state/*.svelte.ts`
- UI primitives (shadcn-svelte, copy-paste model): `src/lib/components/ui/*`

`bun --bun` is the canonical runtime. Bun runs Vite, the build, tests, and the production server. Do not assume Node.

## Commands

Run from repo root unless noted.

- Install: `bun install`
- Dev (port 3000, fails fast if busy): `bun --bun run dev` (requires `OTPRAVKARR_SECRET` env)
- Build: `bun --bun run build` (also copies `src/lib/db/migrations` → `build/server/migrations`)
- Production start: `bun ./build/index.js`
- Lint + format check (Biome, the only linter): `bun run check`
- Format write: `bun run format`
- Unit tests (Vitest, jsdom): `bun run test`
- Single test file: `bunx vitest run path/to/file.test.ts`
- Single test name: `bunx vitest run -t "test name"`
- E2E (Playwright; auto-builds, seeds DB, runs `bun ./build/index.js` on port 4173): `bun run test:e2e`
- Type check: `bunx tsc --noEmit`
- Svelte check: `bunx svelte-check --threshold warning`
- Pre-commit (runs Biome + svelte-check + tsc): handled by `prek` per `prek.toml`
- CI-equivalent local validation: `bun run check && bunx svelte-check --threshold warning && bunx tsc --noEmit && bun run test`

Required dev env: `export OTPRAVKARR_SECRET=$(openssl rand -base64 32)`. Optional: `DATABASE_PATH`, `HOST`, `PORT`, `ORIGIN` (see `README.md`).

## High-level architecture

`src/hooks.server.ts` defines the request pipeline as `sequence(requestLogger, localsInit, runtimeInit, setupGate, sessionResolver, csrfValidator, securityHeaders)`. On first request, `runtimeInit` validates env, runs DB migrations, registers scheduler jobs, and prints the bootstrap token if setup is incomplete. `setupGate` redirects every non-`/setup`, non-`/api/health`, non-static request to `/setup` until `setup_completed` is true. `csrfValidator` enforces an `Origin`/`Referer` allowlist on POST/PUT/PATCH/DELETE (allowlist comes from the `allowed_origins` config row, falling back to `ORIGIN`).

DB is a single `bun:sqlite` connection (`src/lib/db/connection.ts`) exposed as a `db` Proxy that lazy-initializes. Schema lives in `src/lib/db/migrations/NNN_name.sql`; `src/lib/db/migrate.ts` applies pending migrations atomically inside one transaction and tracks them in `_migrations`. All DB access goes through repositories in `src/lib/db/repositories/*` (`admin`, `audit`, `config`, `sessions`, `users`), each of which owns its own lazy-initialized prepared statements.

The scheduler (`src/lib/scheduler/runner.ts`) is an in-process `setTimeout` runner with overlap and zombie-callback guards. Jobs (`sync`, `health`, `cleanup`, `audit-rotation`) are factories under `src/lib/scheduler/jobs/*` and are registered in `hooks.server.ts:registerSchedulerJobs`.

The Plex ↔ Dispatcharr business logic lives in `src/lib/bridge/`: `provisioner.ts` (create/repair user mappings) and `lifecycle.ts` (`reconcileSync`, `rotateCredentials`, `disableUser`, `enableUser`). External calls go through `src/lib/dispatcharr/client.ts` (a `DispatcharrClient` over `ofetch`, with redacted-body logging) plus `src/lib/dispatcharr/endpoints/*`, and through `src/lib/plex/client.ts` / `oauth.ts` / `friends.ts`. Secrets are encrypted with `src/lib/crypto/encryption.ts` (keyed off `OTPRAVKARR_SECRET`) before being stored.

UI uses UnoCSS with `presetWind4` + `presetShadcn` (no Tailwind) and shadcn-svelte components. Shared client state uses Svelte 5 runes in `*.svelte.ts` modules under `src/lib/state/`.

## Task workflows

### Add a Zod-validated form action
1. Add or extend a schema in `src/lib/server/validation.ts`.
2. In `+page.server.ts`, parse with `parseFormData(formData, Schema)` (uses `sanitizeString`) or `Schema.safeParse(...)`. Return `fail(400, ...)` on failure.
3. Call `requireAdmin(event)` (admin pages) or `requireUser(event)` (portal pages) at the top of `load`/`actions`.
4. After a successful state change, call `appendAuditLog({ action: AuditAction.X, ... })`.
5. CSRF is enforced globally by the hook — do not add per-route CSRF code.

### Add a database migration
1. Create `src/lib/db/migrations/NNN_short_name.sql` with the next sequential `NNN`.
2. Use plain SQL; the runner executes the whole file via `db.exec` inside a transaction.
3. Update affected repository files in `src/lib/db/repositories/*` and `src/lib/db/types.ts`.
4. Reset any module-level prepared statement caches you alter via `_resetStatementsForTesting` in tests.
5. Migrations are auto-applied on server boot. The build script copies them into `build/server/migrations`.

### Add a scheduled job
1. Create `src/lib/scheduler/jobs/<name>.ts` exporting `createXJob(): Job` (or `Promise<Job>`) with `{ name, interval, fn }`.
2. Register it in `src/hooks.server.ts:registerSchedulerJobs`.
3. Read live config inside `fn`; do not capture stale values from setup time.

### Add an admin JSON API endpoint
1. Create `src/routes/api/internal/<name>/+server.ts`.
2. Call `await requireAdminApi(event)` first (it throws 401 instead of redirecting).
3. Pull config via `getConfig(...)`, instantiate `DispatcharrClient` if needed, and audit-log via `appendAuditLog`.

### Add an admin page
1. Create under `src/routes/(admin)/<name>/+page.server.ts` and `+page.svelte`.
2. `load` must call `requireAdmin(event)`; the `(admin)` group has no shared guard.

## Decision tables

| Situation | Use this | Avoid |
| --- | --- | --- |
| Server-side input validation | A Zod schema in `src/lib/server/validation.ts` + `parseFormData` | Ad hoc string checks in route handlers |
| Outbound HTTP to Dispatcharr | `new DispatcharrClient(...)` + helpers in `src/lib/dispatcharr/endpoints/*` | Direct `fetch`/`ofetch` calls from routes |
| Outbound HTTP to Plex | `src/lib/plex/client.ts`, `oauth.ts`, `friends.ts` | Re-implementing OAuth or token discovery |
| Reading/writing rows | A function in `src/lib/db/repositories/*` (statements live there) | Raw `db.prepare(...)` in routes or jobs |
| Encrypting a secret before storage | `encrypt(value, purpose)` from `src/lib/crypto/encryption.ts` | Storing plaintext in `config` or `user_mappings` |
| Gating an admin page load | `await requireAdmin(event)` (redirects to `/login`) | Manual cookie checks |
| Gating an admin JSON API | `await requireAdminApi(event)` (throws 401) | `requireAdmin` on API routes |
| Gating a portal page | `await requireUser(event)` | Trusting `event.locals.user` without re-checking |
| URL accepting credentialled traffic | `isSafeHttpSecretUrl(value)` (HTTPS, or HTTP only on loopback) | Allowing arbitrary `http://` |
| Cross-component reactive state | A `$state(...)` proxy exported from `src/lib/state/<name>.svelte.ts` | Re-assigning the proxy or using legacy stores |
| Persisting an action's intent | `appendAuditLog({ action: AuditAction.X, ... })` from the action site | Logging via `console.log` only |

## Code patterns

Lazy prepared-statement repository (`src/lib/db/repositories/users.ts`):
```ts
let stmtGetById: ReturnType<typeof db.prepare> | null = null;
function getByIdStmt() {
  stmtGetById ??= db.prepare("SELECT * FROM user_mappings WHERE id = ?");
  return stmtGetById;
}
```

Form action with Zod + audit log (`src/routes/login/+page.server.ts`):
```ts
const result = LoginSchema.safeParse({
  username: sanitizeString(String(formData.get("username") ?? "")),
  password: String(formData.get("password") ?? ""),
});
if (!result.success) return fail(400, { error: "missing_credentials" });
```

Shared runes state module (`src/lib/state/user-session.svelte.ts`): export a `$state(...)` object plus mutators; mutate fields, never reassign the proxy.

## Project-specific rules

- Always import the SQLite handle as `db` from `$lib/db/connection`. It is a Proxy that lazy-initializes — do not call `new Database(...)` elsewhere.
- All credentialled outbound URLs (Plex server URL, Dispatcharr URL, Dispatcharr external URL) must pass `isSafeHttpSecretUrl` before being stored or used. The Zod schemas in `validation.ts` already do this — keep new URL fields consistent.
- Sessions are a single cookie (`SESSION_COOKIE_NAME = "otpravkarr_session"`) with `session_type` of `"admin"` or `"user"`. Use `requireAdmin` / `requireAdminApi` / `requireUser`; do not invent a third gate.
- Setup is gated by the `setup_completed` config row, not by the presence of an admin account. When extending setup, update `SETUP_COMPLETED_CONFIG_KEY` writes in `src/routes/setup/+page.server.ts`.
- The bootstrap token is in-memory and per-process. Restarting invalidates it; printing it lives in `hooks.server.ts:printBootstrapBanner`.
- Tests use Vitest (`vitest.config.ts`, jsdom, `$lib` alias, `$app/forms` stubbed via `src/lib/test-stubs/app-forms.ts`); `vitest-setup.ts` is the global setup. E2E tests live in `e2e/` and are excluded from Vitest. Co-locate unit tests in `__tests__/` next to the code they cover.
- Biome is the only linter/formatter. Do not add ESLint, Prettier, or Tailwind.
- Filenames follow Svelte conventions: `kebab-case` for modules and routes, `PascalCase.svelte` for components, `*.svelte.ts` for runes-bearing modules.

## References

- `README.md` — env vars, deployment checklist, public API surface.
- `prek.toml` — exact pre-commit hooks; mirror these locally before pushing.
- `playwright.config.ts` — how E2E builds and seeds the DB; read before changing E2E setup or ports.
- `.augment/rules/bun-svelte-pro.md` — generic Bun + Svelte 5 + SvelteKit 2 + UnoCSS + shadcn-svelte reference. Useful background, but it is not project-specific; prefer this file for Otpravkarr conventions.
- `src/lib/db/migrations/001_initial.sql` — current schema source of truth; read before designing a new migration.
