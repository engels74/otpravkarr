# Otpravkarr — Implementation Plan

> **Based on:** `docs/otpravkarr-prd.md` (Draft v0.2)
> **Coding standards:** `.augment/rules/bun-svelte-pro.md`
> **API references:** `docs/ctrl-plex-api-docs.md`, `docs/dispatcharr-api-docs.md`
> **License:** AGPL-3.0
> **Created:** 2026-03-31

---

## Phase 0 — Project Scaffolding & Toolchain

### 0.1 — Create the SvelteKit project

- [x] Scaffold the project with `bunx sv create otpravkarr` (select Svelte 5, TypeScript strict)
- [x] `cd otpravkarr && bun install`
- [x] Verify dev server runs with `bun --bun run dev`

### 0.2 — Install and configure `svelte-adapter-bun`

- [x] `bun add -d svelte-adapter-bun`
- [x] Create `svelte.config.ts` with adapter-bun:
  ```
  adapter({ out: 'build', serveAssets: true, precompress: true, envPrefix: '' })
  ```
- [x] Set `vitePreprocess()` as the preprocessor
- [x] Add `package.json` scripts: `dev`, `dev:bun`, `build`, `start` (`bun ./build/index.js`), `check`, `format`, `test`, `test:e2e`

### 0.3 — Install and configure UnoCSS

- [x] `bun add -d @unocss/vite unocss @unocss/preset-wind4 unocss-preset-animations unocss-preset-shadcn`
- [x] Create `vite.config.ts` with `sveltekit()` first, then `UnoCSS()`
- [x] Create `uno.config.ts` with `presetWind4()`, `presetTypography()`, `presetIcons()`, `presetShadcn({ darkSelector: '.dark' })`, `presetAnimations()`
  - [x] Add `createRemToPxProcessor()` to `postprocess`
  - [x] Configure `content.pipeline.include` for `.svelte`, `.svelte.ts`, `.svelte.js`, `.ts`, `.js`
  - [x] Define theme `radius` and `fontFamily` entries
  - [x] Add app-wide shortcuts: `page-shell`, `card`
- [x] Import `uno.css` in `src/hooks.client.ts` (Safari-safe pattern, not in root layout)

### 0.4 — Install and configure shadcn-svelte

- [x] `bun x shadcn-svelte@latest init` (configure for UnoCSS tokens, skip Tailwind)
- [x] Add core components: `bun x shadcn-svelte@latest add button card dialog tabs dropdown-menu sidebar sonner input label badge alert table separator avatar tooltip`
- [x] Create `src/lib/utils/cn.ts` with `clsx` + `tailwind-merge`

### 0.5 — Configure TypeScript strict mode

- [x] Create/update `tsconfig.json` extending `.svelte-kit/tsconfig.json`
  - [x] Enable `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`
  - [x] Enable `verbatimModuleSyntax`
  - [x] Configure `$lib` path alias
  - [x] Add `bun-types` to types array for `bun:sqlite`, `Bun.password`, etc.

### 0.6 — Configure Biome

- [x] `bun add -d @biomejs/biome`
- [x] Create `biome.json`:
  - [x] `indentStyle: "space"`, `indentWidth: 2`, `lineWidth: 100`
  - [x] `linter.rules.recommended: true`
  - [x] `organizeImports.enabled: true`
  - [x] Ignore `build/**`, `.svelte-kit/**`, `dist/**`

### 0.7 — Configure testing infrastructure

- [x] `bunx sv add vitest="usages:unit,component"` + `bun add -d @testing-library/svelte @testing-library/jest-dom`
- [x] Create `vitest.config.ts` with `svelte()` + `svelteTesting()` plugins, `environment: 'jsdom'`, `setupFiles: ['./vitest-setup.ts']`
- [x] Create `vitest-setup.ts` importing `@testing-library/jest-dom/vitest`
- [x] `bun add -d @playwright/test && bunx playwright install`
- [x] Create `playwright.config.ts` with `testDir: './e2e'`, `baseURL: 'http://localhost:4173'`, webServer using `bun run preview`

### 0.8 — Install application dependencies

- [x] `bun add @ctrl/plex` — Plex API client
- [x] `bun add ofetch` — HTTP client for Dispatcharr REST calls
- [x] `bun add zod` — runtime schema validation
- [x] `bun add sveltekit-superforms` — form handling with Zod adapters
- [x] `bun add qrcode` (or lightweight QR library) — client-side QR generation
- [x] `bun add -d bun-types` — Bun runtime type definitions

### 0.9 — Environment variables and `.env`

- [x] Create `.env.example` with all required vars:
  ```
  OTPRAVKARR_SECRET=             # master encryption secret (required)
  DATABASE_PATH=./data/otpravkarr.sqlite
  HOST=0.0.0.0
  PORT=3000
  ORIGIN=http://localhost:3000   # overridden during setup
  ```
- [x] In SvelteKit code, import env via `$env/static/private` and `$env/dynamic/private` as appropriate
- [x] Validate `OTPRAVKARR_SECRET` is set on startup; abort with clear error if missing

### 0.10 — Create `app.html` shell

- [x] Write `src/app.html` minimal shell with `%sveltekit.head%`, `%sveltekit.body%`, `data-sveltekit-preload-data="hover"`

### 0.11 — Create directory structure

- [x] Create all directories matching PRD Section 11:
  ```
  src/lib/plex/
  src/lib/dispatcharr/
  src/lib/dispatcharr/endpoints/
  src/lib/bridge/
  src/lib/db/
  src/lib/db/repositories/
  src/lib/db/migrations/
  src/lib/crypto/
  src/lib/scheduler/
  src/lib/scheduler/jobs/
  src/lib/url/
  src/lib/server/
  src/lib/state/
  src/lib/components/ui/
  src/lib/utils/
  src/routes/setup/
  src/routes/(admin)/
  src/routes/(admin)/dashboard/
  src/routes/(admin)/users/
  src/routes/(admin)/settings/
  src/routes/(admin)/audit/
  src/routes/(portal)/
  src/routes/(portal)/auth/plex/
  src/routes/api/health/
  src/routes/api/internal/
  e2e/
  data/
  ```

### 0.12 — Docker configuration

- [x] Create `Dockerfile`:
  - [x] Use `oven/bun` base image
  - [x] `COPY`, `bun install --frozen-lockfile`, `bun run build`
  - [x] `CMD ["bun", "./build/index.js"]`
  - [x] Expose single port, mount `./data` volume for SQLite persistence
- [x] Create `docker-compose.yml` with single service, volume for `./data`, environment variables
- [x] Create `.dockerignore` excluding `node_modules`, `.svelte-kit`, `build`, `data`

---

## Phase 1 — Cryptography Module (`src/lib/crypto/`)

All sensitive data handling depends on this module. It must be built and tested first.

### 1.1 — Master key derivation (`src/lib/crypto/keys.ts`)

- [x] Read `OTPRAVKARR_SECRET` from `$env/dynamic/private` (runtime access, not build-time)
- [x] Implement HKDF key derivation using Web Crypto API (`crypto.subtle.importKey` + `crypto.subtle.deriveBits`)
- [x] Derive purpose-specific subkeys:
  - [x] `config-encryption` — for encrypting config table values
  - [x] `credential-encryption` — for encrypting XC passwords
  - [x] Each subkey derived with a unique `info` string via HKDF
- [x] Export `deriveKey(purpose: string): Promise<CryptoKey>` function
- [x] Cache derived keys in a module-level `Map<string, CryptoKey>` (they don't change at runtime)
- [x] Write unit tests: deterministic derivation, different purposes produce different keys

### 1.2 — Field-level authenticated encryption (`src/lib/crypto/encryption.ts`)

- [x] Implement `encrypt(plaintext: string, purpose: string): Promise<string>` — AES-256-GCM
  - [x] Generate random 12-byte IV per encryption
  - [x] Concatenate IV + ciphertext + auth tag
  - [x] Return base64-encoded result
- [x] Implement `decrypt(ciphertext: string, purpose: string): Promise<string>` — reverse of above
  - [x] Parse IV from prefix, verify auth tag
  - [x] Throw typed `DecryptionError` on failure
- [x] Write unit tests: round-trip encrypt/decrypt, tamper detection, different purposes fail cross-decrypt

### 1.3 — Password utilities (`src/lib/crypto/passwords.ts`)

- [x] Implement `hashAdminPassword(password: string): Promise<string>` using `Bun.password.hash(password, { algorithm: 'argon2id' })`
- [x] Implement `verifyAdminPassword(password: string, hash: string): Promise<boolean>` using `Bun.password.verify`
- [x] Implement `generateXcPassword(length?: number): string` — cryptographically random, default 24 chars, alphanumeric charset, using `crypto.getRandomValues`
- [x] Write unit tests: hash/verify round-trip, XC password length/charset constraints

### 1.4 — Bootstrap token generation (`src/lib/crypto/bootstrap.ts`)

- [x] Implement `generateBootstrapToken(): string` — format `xxxx-xxxx-xxxx` using `crypto.getRandomValues`
- [x] Token exists only in memory — never persisted to database
- [x] Export a singleton holder: `let activeToken: { value: string; expiresAt: number } | null`
- [x] Implement `createBootstrapToken(ttlMinutes?: number): string` — default 15 minutes, sets `activeToken`
- [x] Implement `consumeBootstrapToken(candidate: string): boolean` — constant-time comparison, single-use (nulls `activeToken` on success)
- [x] Implement `isBootstrapTokenExpired(): boolean`
- [x] Write unit tests: generation format, single-use consumption, expiry behavior, timing-safe comparison

---

## Phase 2 — Database Layer (`src/lib/db/`)

### 2.1 — Connection management (`src/lib/db/connection.ts`)

- [x] Import `Database` from `bun:sqlite`
- [x] Initialize database at the path from `DATABASE_PATH` env var (default `./data/otpravkarr.sqlite`)
- [x] Enable WAL mode: `db.exec('PRAGMA journal_mode=WAL')`
- [x] Enable foreign keys: `db.exec('PRAGMA foreign_keys=ON')`
- [x] Export singleton `db` instance
- [x] Implement `initializeDatabase()` function that runs migrations
- [ ] Call `initializeDatabase()` from SvelteKit server startup (via `hooks.server.ts` init)

### 2.2 — Migration system (`src/lib/db/migrations/`)

- [x] Create `src/lib/db/migrate.ts`:
  - [x] Create internal `_migrations` table: `(version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)`
  - [x] Read SQL files from `src/lib/db/migrations/` sorted by numeric prefix
  - [x] Apply unapplied migrations in order within a transaction
  - [x] Forward-only — no down migrations
- [x] Create `001_initial.sql`:
  ```sql
  CREATE TABLE config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    encrypted INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE user_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plex_account_id INTEGER NOT NULL UNIQUE,
    plex_uuid TEXT NOT NULL,
    plex_username TEXT NOT NULL,
    plex_email TEXT,
    plex_thumb TEXT,
    dispatcharr_user_id INTEGER,
    dispatcharr_username TEXT,
    dispatcharr_xc_password_enc TEXT,
    dispatcharr_group_ids TEXT NOT NULL DEFAULT '[]',  -- JSON array
    dispatcharr_profile_id INTEGER,
    provisioning_mode TEXT NOT NULL DEFAULT 'automatic'
      CHECK (provisioning_mode IN ('automatic', 'self_managed', 'staff')),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_synced_at TEXT,
    last_accessed_at TEXT
  );

  CREATE INDEX idx_user_mappings_plex_id ON user_mappings(plex_account_id);
  CREATE INDEX idx_user_mappings_dispatcharr_id ON user_mappings(dispatcharr_user_id);

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_ref TEXT NOT NULL,
    session_type TEXT NOT NULL CHECK (session_type IN ('admin', 'user')),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX idx_sessions_expires ON sessions(expires_at);

  CREATE TABLE admin_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    actor TEXT,
    action TEXT NOT NULL,
    detail TEXT,  -- JSON
    ip_address TEXT
  );

  CREATE INDEX idx_audit_log_timestamp ON audit_log(timestamp);
  CREATE INDEX idx_audit_log_action ON audit_log(action);
  ```

### 2.3 — Config repository (`src/lib/db/repositories/config.ts`)

- [x] Implement `getConfig(key: string): Promise<string | null>` — reads row, decrypts if `encrypted = 1`
- [x] Implement `setConfig(key: string, value: string, encrypted?: boolean): Promise<void>` — upserts, encrypts value if `encrypted = true` using `lib/crypto` with `config-encryption` purpose
- [x] Implement `getAllConfig(): Promise<Record<string, string>>` — bulk read, decrypt all encrypted fields
- [x] Use prepared statements via `db.prepare()` — cache them at module level
- [x] Implement in-memory config cache:
  - [x] `let configCache: Record<string, string> | null = null`
  - [x] `loadConfigCache()` — populates cache on startup
  - [x] `invalidateConfigCache()` — called after any write
- [x] Write unit tests with an in-memory SQLite database

### 2.4 — User mappings repository (`src/lib/db/repositories/users.ts`)

- [x] Define `UserMapping` type in `src/lib/db/types.ts` matching schema columns
- [x] Implement with prepared statements:
  - [x] `getUserMappingByPlexId(plexAccountId: number): UserMapping | null`
  - [x] `getUserMappingByDispatcharrId(dispatcharrUserId: number): UserMapping | null`
  - [x] `getAllUserMappings(filters?: { isActive?: boolean }): UserMapping[]`
  - [x] `createUserMapping(mapping: Omit<UserMapping, 'id' | 'created_at' | 'updated_at'>): UserMapping`
  - [x] `updateUserMapping(id: number, updates: Partial<UserMapping>): void`
  - [x] `markMappingInactive(id: number): void` — sets `is_active = 0`, updates `updated_at`
  - [x] `updateLastAccessed(id: number): void`
  - [x] `updateLastSynced(id: number): void`
  - [x] `updatePlexIdentity(id: number, username: string, email: string | null, thumb: string | null): void`
- [x] XC password stored/retrieved via `lib/crypto` encryption with `credential-encryption` purpose
- [x] Write unit tests

### 2.5 — Session repository (`src/lib/db/repositories/sessions.ts`)

- [x] `createSession(userRef: string, type: 'admin' | 'user', ttlSeconds: number): string` — generates UUID session ID, inserts row, returns ID
- [x] `getSession(id: string): { userRef: string; sessionType: string; expiresAt: string } | null` — returns null if expired
- [x] `deleteSession(id: string): void`
- [x] `deleteExpiredSessions(): number` — cleanup, returns count deleted
- [x] Write unit tests

### 2.6 — Admin accounts repository (`src/lib/db/repositories/admin.ts`)

- [x] `createAdmin(username: string, passwordHash: string): void`
- [x] `getAdminByUsername(username: string): { id: number; username: string; passwordHash: string } | null`
- [x] `adminExists(): boolean` — `SELECT COUNT(*) FROM admin_accounts > 0`
- [x] Write unit tests

### 2.7 — Audit log repository (`src/lib/db/repositories/audit.ts`)

- [x] `appendAuditLog(entry: { actor?: string; action: string; detail?: Record<string, unknown>; ipAddress?: string }): void`
  - [x] Serialize `detail` as JSON string
- [x] `queryAuditLog(filters: { action?: string; actor?: string; after?: string; before?: string; limit?: number; offset?: number }): { entries: AuditEntry[]; total: number }`
- [x] Action type constants exported from `src/lib/db/types.ts`:
  ```ts
  export const AuditAction = {
    SETUP_COMPLETED: 'setup.completed',
    ADMIN_LOGIN: 'admin.login',
    USER_PROVISIONED: 'user.provisioned',
    USER_DISABLED: 'user.disabled',
    USER_CREDENTIALS_ROTATED: 'user.credentials_rotated',
    SYNC_COMPLETED: 'sync.completed',
    CONFIG_CHANGED: 'config.changed',
    HEALTH_CHECK_FAILED: 'health.check_failed',
  } as const;
  ```
- [x] Write unit tests

### 2.8 — Database types (`src/lib/db/types.ts`)

- [x] Define `UserMapping` interface matching all columns
- [x] Define `AuditEntry` interface
- [x] Define `Session` interface
- [x] Define `AdminAccount` interface
- [x] Define `ConfigEntry` interface
- [x] Define `ProvisioningMode = 'automatic' | 'self_managed' | 'staff'`

---

## Phase 3 — Plex Integration Module (`src/lib/plex/`)

### 3.1 — Type definitions (`src/lib/plex/types.ts`)

- [ ] Define `PlexIdentity` — `{ id: number; uuid: string; username: string; email: string; thumb: string; authenticationToken: string }`
- [ ] Define `PlexFriend` — `{ id: number; uuid?: string; username: string; email: string; thumb?: string; status: string }` (response shape from plex.tv friends endpoint, validated defensively)
- [ ] Define `PlexConnectionStatus` — `'healthy' | 'unauthorized' | 'unreachable' | 'server_changed'`
- [ ] Define `PlexServerInfo` — `{ friendlyName: string; machineIdentifier: string; version: string }`

### 3.2 — Plex client wrapper (`src/lib/plex/client.ts`)

- [ ] Import `PlexServer`, `MyPlexAccount`, `Unauthorized` from `@ctrl/plex`
- [ ] Implement `validateServerToken(url: string, token: string): Promise<PlexServerInfo>`
  - [ ] `new PlexServer(url, token).connect()`
  - [ ] Assert `friendlyName` and `machineIdentifier` are populated
  - [ ] Catch `Unauthorized` → throw typed `PlexAuthError`
  - [ ] Catch network errors → throw typed `PlexConnectionError`
- [ ] Implement `checkServerHealth(url: string, token: string, expectedMachineId: string): Promise<PlexConnectionStatus>`
  - [ ] Connect, compare `machineIdentifier` with `expectedMachineId`
  - [ ] Return `'healthy'`, `'unauthorized'`, `'unreachable'`, or `'server_changed'`
- [ ] Implement `getAccount(token: string): Promise<MyPlexAccount>`
  - [ ] `new MyPlexAccount({ token }).connect()`
- [ ] Implement `getServerResources(account: MyPlexAccount): Promise<Array<{ name: string; machineId: string; connect: () => Promise<PlexServer> }>>`
  - [ ] `account.resources()` → map to simplified objects
- [ ] Write unit tests (mocking `@ctrl/plex` classes)

### 3.3 — OAuth flow helpers (`src/lib/plex/oauth.ts`)

- [ ] Implement `initiateOAuth(forwardUrl: string): Promise<{ uri: string; webLogin: WebLogin }>`
  - [ ] Call `MyPlexAccount.getWebLogin(forwardUrl)`
  - [ ] Return `{ uri: webLogin.uri, webLogin }`
- [ ] Implement `completeOAuth(webLogin: WebLogin, timeoutSeconds?: number): Promise<PlexIdentity>`
  - [ ] Call `MyPlexAccount.webLoginCheck(webLogin, { timeoutSeconds: timeoutSeconds ?? 120 })`
  - [ ] Extract `id`, `uuid`, `username`, `email`, `thumb`, `authenticationToken` from returned `MyPlexAccount`
  - [ ] Return as `PlexIdentity`
- [ ] Store pending `WebLogin` objects in a server-side in-memory map keyed by a random session token (they must survive across the redirect)
- [ ] Write unit tests

### 3.4 — Friend enumeration (`src/lib/plex/friends.ts`)

- [ ] Implement `fetchFriends(account: MyPlexAccount): Promise<PlexFriend[]>`
  - [ ] Use `account.query({ url: 'https://plex.tv/api/v2/friends', method: 'get' })`
  - [ ] Parse response defensively — define Zod schema for `PlexFriend[]`
  - [ ] Log warnings for unexpected response shapes
  - [ ] Return validated array
- [ ] Implement `isCurrentFriend(plexAccountId: number, friends: PlexFriend[]): boolean`
  - [ ] Simple `friends.some(f => f.id === plexAccountId)`
- [ ] Cache friend list in module-level variable with TTL (refreshed by sync job)
- [ ] Write unit tests with mock responses

---

## Phase 4 — Dispatcharr Integration Module (`src/lib/dispatcharr/`)

### 4.1 — Type definitions (`src/lib/dispatcharr/types.ts`)

- [ ] Define `DispatcharrUser` — `{ id: number; username: string; email?: string; is_staff: boolean; is_active: boolean; groups: number[] }`
- [ ] Define `DispatcharrGroup` — `{ id: number; name: string; permissions: number[] }`
- [ ] Define `DispatcharrChannelProfile` — `{ id: number; name: string }`
- [ ] Define `DispatcharrChannel` — `{ id: number; name: string; number: number; enabled: boolean }`
- [ ] Define `PaginatedResponse<T>` — `{ count: number; next: string | null; previous: string | null; results: T[] }`
- [ ] Define `DispatcharrResult<T>` — discriminated union:
  ```ts
  type DispatcharrResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: 'auth_failure' | 'network_error' | 'unexpected_shape' | 'not_found'; message: string };
  ```

### 4.2 — Pagination helper (`src/lib/dispatcharr/pagination.ts`)

- [ ] Implement `async function* paginate<T>(client: DispatcharrClient, initialUrl: string): AsyncGenerator<T[], void, undefined>`
  - [ ] Fetch first page, yield `results`
  - [ ] Follow `next` URL until `null`
  - [ ] Handle DRF pagination envelope (`count`, `next`, `previous`, `results`)
- [ ] Implement `fetchAllPages<T>(client: DispatcharrClient, url: string): Promise<T[]>` — collects all pages into array
- [ ] Write unit tests with mock paginated responses

### 4.3 — Base client (`src/lib/dispatcharr/client.ts`)

- [ ] Import `ofetch` from `ofetch`
- [ ] Implement `DispatcharrClient` class:
  - [ ] Constructor takes `baseUrl: string` and `apiKey: string`
  - [ ] All requests include `Authorization: ApiKey <key>` header
  - [ ] Implement `request<T>(method, path, body?): Promise<DispatcharrResult<T>>`
    - [ ] Wrap `ofetch` call in try/catch
    - [ ] Map HTTP 401 → `{ ok: false, error: 'auth_failure' }`
    - [ ] Map HTTP 404 → `{ ok: false, error: 'not_found' }`
    - [ ] Map network errors → `{ ok: false, error: 'network_error' }`
    - [ ] Validate response shape with Zod → `{ ok: false, error: 'unexpected_shape' }` on mismatch
    - [ ] No raw exceptions leak to callers
- [ ] Write unit tests

### 4.4 — User endpoints (`src/lib/dispatcharr/endpoints/users.ts`)

- [ ] `listUsers(page?: number, pageSize?: number): Promise<DispatcharrResult<PaginatedResponse<DispatcharrUser>>>`
  - [ ] `GET /api/accounts/users/?page={page}&page_size={pageSize}`
- [ ] `createUser(data: { username: string; password: string; email?: string; is_staff?: boolean; is_active?: boolean; groups?: number[] }): Promise<DispatcharrResult<DispatcharrUser>>`
  - [ ] `POST /api/accounts/users/`
- [ ] `getUser(id: number): Promise<DispatcharrResult<DispatcharrUser>>`
  - [ ] `GET /api/accounts/users/{id}/`
- [ ] `updateUser(id: number, data: Partial<{ password: string; email: string; is_active: boolean; is_staff: boolean; groups: number[] }>): Promise<DispatcharrResult<DispatcharrUser>>`
  - [ ] `PUT /api/accounts/users/{id}/`
- [ ] `deleteUser(id: number): Promise<DispatcharrResult<void>>`
  - [ ] `DELETE /api/accounts/users/{id}/` (used rarely; prefer deactivation)
- [ ] Validate all responses against Zod schemas for `DispatcharrUser`
- [ ] Write unit tests

### 4.5 — Group endpoints (`src/lib/dispatcharr/endpoints/groups.ts`)

- [ ] `listGroups(): Promise<DispatcharrResult<DispatcharrGroup[]>>`
  - [ ] `GET /api/accounts/groups/` — may be paginated; handle accordingly
- [ ] Write unit tests

### 4.6 — Channel profile endpoints (`src/lib/dispatcharr/endpoints/profiles.ts`)

- [ ] `listProfiles(): Promise<DispatcharrResult<DispatcharrChannelProfile[]>>`
  - [ ] `GET /api/channels/profiles/`
- [ ] Write unit tests

### 4.7 — Channel endpoints (`src/lib/dispatcharr/endpoints/channels.ts`)

- [ ] `listChannels(page?: number, pageSize?: number): Promise<DispatcharrResult<PaginatedResponse<DispatcharrChannel>>>`
  - [ ] `GET /api/channels/channels/?page={page}&page_size={pageSize}`
- [ ] `getAllChannels(): Promise<DispatcharrResult<DispatcharrChannel[]>>`
  - [ ] Uses `fetchAllPages` to iterate through all pages
- [ ] `getChannelStreams(channelId: number): Promise<DispatcharrResult<any[]>>`
  - [ ] `GET /api/channels/channels/{id}/streams/`
- [ ] Write unit tests

### 4.8 — Health check (`src/lib/dispatcharr/endpoints/health.ts`)

- [ ] `checkHealth(): Promise<DispatcharrResult<{ reachable: boolean; authValid: boolean }>>`
  - [ ] `GET /api/accounts/users/?page=1&page_size=1`
  - [ ] 200 → `{ reachable: true, authValid: true }`
  - [ ] 401 → `{ reachable: true, authValid: false }`
  - [ ] Network error → `{ reachable: false, authValid: false }`
- [ ] Write unit tests

---

## Phase 5 — URL & Playlist Generation (`src/lib/url/`)

### 5.1 — XC format URL generation (`src/lib/url/xc.ts`)

- [ ] Define configurable URL template:
  ```ts
  const DEFAULT_XC_TEMPLATE = '{protocol}://{host}/get.php?username={username}&password={password}&type=m3u_plus';
  ```
- [ ] Implement `buildXcUrl(params: { host: string; username: string; password: string; protocol?: 'http' | 'https'; template?: string }): string`
- [ ] Implement `buildPlayerApiUrl(params: { host: string; username: string; password: string }): string` — `player_api.php` variant
- [ ] Pure functions, no side effects
- [ ] Write unit tests with template substitution edge cases

### 5.2 — XC surface discovery probe (`src/lib/url/discover.ts`)

- [ ] Implement `probeXcSurface(host: string, username: string, password: string): Promise<{ found: boolean; template?: string; probedPaths: string[] }>`
  - [ ] Try `GET {host}/get.php?username={user}&password={pass}&type=m3u_plus`
  - [ ] Try `GET {host}/player_api.php?username={user}&password={pass}`
  - [ ] Check for recognizable XC response patterns
  - [ ] Return discovered template or failure info
- [ ] Used during setup step and surfaced in admin settings
- [ ] Write unit tests

### 5.3 — M3U playlist generation (`src/lib/url/m3u.ts`)

- [ ] Implement `generateM3U(params: { channels: DispatcharrChannel[]; host: string; username: string; password: string; template?: string }): string`
  - [ ] Generate `#EXTM3U` header
  - [ ] For each channel: `#EXTINF:-1 tvg-name="{name}" tvg-chno="{number}",{name}` followed by stream URL
  - [ ] Bake credentials into each stream URL using XC live-stream path format
- [ ] Return complete `.m3u` file body as string
- [ ] Write unit tests

### 5.4 — Platform-specific variants (`src/lib/url/platforms.ts`)

- [ ] Define `Platform = 'generic' | 'vlc' | 'tivimate' | 'smarters'`
- [ ] Implement `buildPlatformUrl(platform: Platform, params: XcUrlParams): string`
- [ ] Each platform may adjust URL parameters or format slightly
- [ ] Write unit tests

### 5.5 — QR code data URI generation (client-side)

- [ ] Implement in a Svelte component or `$lib/utils/qrcode.ts`
- [ ] Generate QR code from URL string as data URI
- [ ] No server round-trip — entirely browser-side
- [ ] Use a lightweight QR library or canvas-based approach

---

## Phase 6 — Bridge / Domain Logic (`src/lib/bridge/`)

### 6.1 — Type definitions (`src/lib/bridge/types.ts`)

- [ ] Define `ProvisioningMode = 'automatic' | 'self_managed' | 'staff'`
- [ ] Define `ProvisioningRequest` — `{ plexIdentity: PlexIdentity; mode: ProvisioningMode; groupIds: number[]; profileId?: number }`
- [ ] Define `ProvisioningResult` — discriminated union for success/already-exists/failure
- [ ] Define `SyncReport` — `{ newFriends: number; disabled: number; orphaned: number; refreshed: number; errors: string[] }`

### 6.2 — User provisioning (`src/lib/bridge/provisioner.ts`)

- [ ] Implement `provisionUser(request: ProvisioningRequest): Promise<ProvisioningResult>`:
  1. Check `user_mappings` for existing mapping by `plex_account_id`
  2. If mapping exists and is active → return `already_exists` with existing data
  3. If mapping exists but inactive → re-enable flow (PUT `is_active: true` on Dispatcharr, reactivate local mapping)
  4. If no mapping → create new:
     - [ ] Sanitize Plex username for Dispatcharr uniqueness (append numeric suffix if needed)
     - [ ] **Automatic mode:** generate XC password via `lib/crypto/passwords.generateXcPassword()`
     - [ ] **Self-managed mode:** generate temporary password (discarded after Dispatcharr creation)
     - [ ] **Staff mode:** same as self-managed but with `is_staff: true`
     - [ ] POST to Dispatcharr `/api/accounts/users/` with `{ username, password, is_staff, is_active: true, groups: [...groupIds] }`
     - [ ] On success: store mapping in `user_mappings` table
     - [ ] For automatic mode: encrypt and store XC password in `dispatcharr_xc_password_enc`
     - [ ] For self-managed/staff: set `dispatcharr_xc_password_enc = null`
  5. Append audit log entry `user.provisioned`
- [ ] Write unit tests with mocked database and Dispatcharr client

### 6.3 — Credential lifecycle (`src/lib/bridge/lifecycle.ts`)

- [ ] Implement `rotateCredentials(mappingId: number): Promise<void>`:
  - [ ] Generate new XC password
  - [ ] PUT new password to Dispatcharr `/api/accounts/users/{id}/`
  - [ ] Re-encrypt and update `dispatcharr_xc_password_enc` in local DB
  - [ ] Append audit log `user.credentials_rotated`
- [ ] Implement `disableUser(mappingId: number): Promise<void>`:
  - [ ] PUT `{ is_active: false }` to Dispatcharr
  - [ ] Mark local mapping as inactive
  - [ ] Append audit log `user.disabled`
- [ ] Implement `enableUser(mappingId: number): Promise<void>`:
  - [ ] PUT `{ is_active: true }` to Dispatcharr
  - [ ] Mark local mapping as active
- [ ] Implement `reconcileSync(): Promise<SyncReport>`:
  1. Fetch Plex friends via `lib/plex/friends.ts`
  2. Fetch all local `user_mappings`
  3. **Removed from Plex** — call `disableUser()` for each
  4. **New on Plex** — flag as "available" (do NOT auto-provision; provisioning is OAuth-triggered or admin-initiated)
  5. **Existing** — verify Dispatcharr account still exists via GET `/api/accounts/users/{id}/`
     - [ ] If 404 → mark mapping as `orphaned`
     - [ ] If exists → compare `groups` and `is_active`, reconcile drift
  6. **Plex identity refresh** — update `plex_username`, `plex_email`, `plex_thumb` from friend data
  7. Write sync results to audit log
  8. Return `SyncReport`
- [ ] Write unit tests

---

## Phase 7 — Server Utilities (`src/lib/server/`)

### 7.1 — Auth guards (`src/lib/server/auth.ts`)

- [ ] Implement `requireAdmin(event: RequestEvent): Promise<AdminAccount>`
  - [ ] Read session cookie, look up session in DB
  - [ ] Verify session type is `admin` and not expired
  - [ ] Throw `redirect(303, '/login')` if invalid
- [ ] Implement `requireUser(event: RequestEvent): Promise<UserMapping>`
  - [ ] Read session cookie, look up session in DB
  - [ ] Verify session type is `user` and not expired
  - [ ] Throw `redirect(303, '/')` if invalid
- [ ] Implement `requireSetupIncomplete(): void`
  - [ ] Check `adminExists()` — if admin exists, setup is complete → throw `error(404)`
- [ ] Implement `isSetupComplete(): boolean`

### 7.2 — CSRF origin validation (`src/lib/server/csrf.ts`)

- [ ] Implement `validateOrigin(request: Request, allowedOrigins: string[]): void`
  - [ ] Read `Origin` header from request
  - [ ] Compare against `allowedOrigins` from config
  - [ ] Throw `error(403, 'CSRF origin mismatch')` on failure
- [ ] Only enforce on state-mutating methods (POST, PUT, PATCH, DELETE)
- [ ] Skip during setup flow (no origin configured yet)
- [ ] Write unit tests

### 7.3 — Rate limiting (`src/lib/server/ratelimit.ts`)

- [ ] Implement in-memory sliding-window rate limiter
- [ ] `createRateLimiter(config: { windowMs: number; maxRequests: number }): RateLimiter`
- [ ] `RateLimiter.check(key: string): { allowed: boolean; remaining: number; resetAt: number }`
- [ ] Pre-configure limiters:
  - [ ] Setup endpoint: 5 attempts per 15 minutes (keyed by IP)
  - [ ] Admin login: 10 attempts per 15 minutes (keyed by IP)
  - [ ] User OAuth: 20 attempts per 15 minutes (keyed by IP)
- [ ] Write unit tests

### 7.4 — Logging (`src/lib/server/logging.ts`)

- [ ] Implement structured request logger
- [ ] Log method, path, status, duration, IP
- [ ] Integrate with SvelteKit `handle` hook
- [ ] Use `console.log` with JSON format for container-friendly logging

---

## Phase 8 — Scheduler & Background Jobs (`src/lib/scheduler/`)

### 8.1 — Job runner (`src/lib/scheduler/runner.ts`)

- [ ] Define `Job` type: `{ name: string; interval: number; fn: () => Promise<void> }`
- [ ] Implement `Scheduler` class:
  - [ ] `register(job: Job): void` — add job to registry
  - [ ] `start(): void` — begin all intervals
  - [ ] `stop(): void` — clear all intervals
  - [ ] `setInterval`-based with drift correction
  - [ ] Overlap guard: if a job's `fn` is still running when next tick fires, skip
  - [ ] Track last-run timestamp and duration per job
- [ ] Export singleton `scheduler` instance
- [ ] Start scheduler from `hooks.server.ts` on first request or server init
- [ ] Write unit tests

### 8.2 — Sync job (`src/lib/scheduler/jobs/sync.ts`)

- [ ] Import `reconcileSync` from `lib/bridge/lifecycle`
- [ ] Export job definition: `{ name: 'plex-dispatcharr-sync', interval: configuredSyncInterval, fn: runSync }`
- [ ] `runSync()`:
  - [ ] Call `reconcileSync()`
  - [ ] Log report to console and audit log
  - [ ] On error: log error, append to audit log, do not crash
- [ ] Default interval: 15 minutes (configurable via `config` table)

### 8.3 — Health check job (`src/lib/scheduler/jobs/health.ts`)

- [ ] Check Plex health via `lib/plex/client.checkServerHealth()`
- [ ] Check Dispatcharr health via `lib/dispatcharr/endpoints/health.checkHealth()`
- [ ] Check SQLite health via write-read cycle
- [ ] Store results in module-level reactive state (accessible from admin dashboard)
- [ ] On failure: append audit log entry `health.check_failed`
- [ ] Default interval: 5 minutes

### 8.4 — Session cleanup job (`src/lib/scheduler/jobs/cleanup.ts`)

- [ ] Call `deleteExpiredSessions()` from session repository
- [ ] Default interval: 30 minutes
- [ ] Log count of deleted sessions

### 8.5 — Audit log rotation job (`src/lib/scheduler/jobs/audit-rotation.ts`)

- [ ] Delete audit log entries older than configured max age (default: 90 days)
- [ ] Default interval: 24 hours
- [ ] Log count of rotated entries

---

## Phase 9 — SvelteKit Server Hooks (`src/hooks.server.ts`)

### 9.1 — Main handle hook

- [ ] Implement `handle: Handle` function composing all middleware concerns:
  1. **Setup gate:** if `!isSetupComplete()` and path is not `/setup` or static asset → `redirect(303, '/setup')`
  2. **Request logging:** log method, path, IP
  3. **CSRF validation:** on POST/PUT/PATCH/DELETE, call `validateOrigin()` with configured allowed origins (skip if setup incomplete)
  4. **Session resolution:** read session cookie, look up session in DB, attach to `event.locals`:
     - [ ] `event.locals.session` — session data or null
     - [ ] `event.locals.admin` — admin account or null (if admin session)
     - [ ] `event.locals.user` — user mapping or null (if user session)
  5. **Resolve:** `return resolve(event)`

### 9.2 — SvelteKit `App.Locals` declaration

- [ ] Declare in `src/app.d.ts`:
  ```ts
  declare global {
    namespace App {
      interface Locals {
        requestId: string;
        session: { id: string; type: 'admin' | 'user'; userRef: string } | null;
        admin: { id: number; username: string } | null;
        user: UserMapping | null;
      }
    }
  }
  ```

### 9.3 — Database and scheduler initialization

- [ ] Initialize database connection and run migrations on server startup
- [ ] Start scheduler on server startup
- [ ] If no admin exists → generate bootstrap token, print to stdout:
  ```
  ========================================
  OTPRAVKARR FIRST-RUN SETUP
  ========================================
  Bootstrap token: xxxx-xxxx-xxxx
  Setup URL: http://<host>:<port>/setup?token=xxxx-xxxx-xxxx
  This token expires in 15 minutes.
  ========================================
  ```

### 9.4 — Client hooks (`src/hooks.client.ts`)

- [ ] Import `uno.css` (Safari-safe UnoCSS loading)
- [ ] Any client-only initialization

---

## Phase 10 — First-Run Onboarding (`src/routes/setup/`)

### 10.1 — Setup page server load (`src/routes/setup/+page.server.ts`)

- [ ] `load` function:
  - [ ] Call `requireSetupIncomplete()` — returns 404 if setup already done
  - [ ] Check for `?token=` query param
  - [ ] Return `{ tokenProvided: boolean; tokenFromUrl: string | null }`
- [ ] Form actions:
  - [ ] **`claimInstance`**: validate bootstrap token (rate-limited to 5 attempts)
  - [ ] **`createAdmin`**: validate username/password, hash with argon2id, save to `admin_accounts`
  - [ ] **`configurePlex`**: accept Plex token or initiate OAuth flow, validate connection, save encrypted token and server info to `config`
  - [ ] **`configureDispatcharr`**: accept URL + API key, validate via GET `/api/accounts/users/?page=1&page_size=1`, save encrypted key to `config`
  - [ ] **`configureOrigin`**: save allowed origins to `config`, auto-suggest from current request origin
  - [ ] **`setDefaults`**: fetch Dispatcharr groups (GET `/api/accounts/groups/`) and profiles (GET `/api/channels/profiles/`), save selections to `config`

### 10.2 — Setup page UI (`src/routes/setup/+page.svelte`)

- [ ] Multi-step wizard component using Svelte 5 runes:
  - [ ] `let step = $state(0)` — tracks current step (0-5)
  - [ ] Each step rendered conditionally with `{#if step === N}` blocks
- [ ] **Step 0 — Claim Instance**: token input field (pre-filled from URL param), submit button
- [ ] **Step 1 — Create Admin**: username + password + confirm password fields, validation
- [ ] **Step 2 — Plex Connection**: two paths — paste token or "Sign in with Plex" OAuth button
  - [ ] OAuth path: redirect to Plex login URI, poll with `webLoginCheck`
  - [ ] Token path: input field, validate on submit
  - [ ] Show server info on success (friendly name, machine identifier)
- [ ] **Step 3 — Dispatcharr Connection**: URL + API key fields, validate on submit
  - [ ] Show connection status, handle "Dispatcharr not initialized" case with guidance
  - [ ] Run XC surface discovery probe and show results
- [ ] **Step 4 — Origin/CSRF**: input for allowed origins, pre-filled with current origin
- [ ] **Step 5 — Defaults**: dropdowns for default group, default profile, sync interval, provisioning mode
- [ ] On completion:
  - [ ] Invalidate bootstrap token
  - [ ] Create admin session
  - [ ] Redirect to `/dashboard`
  - [ ] Append audit log `setup.completed`
- [ ] Use shadcn-svelte components: `Card`, `Button`, `Input`, `Label`, `Alert`, `Badge`, `Separator`
- [ ] Use SvelteKit form actions with `use:enhance` for progressive enhancement

---

## Phase 11 — Admin Dashboard (`src/routes/(admin)/`)

### 11.1 — Admin layout (`src/routes/(admin)/+layout.server.ts` + `+layout.svelte`)

- [ ] `+layout.server.ts`: call `requireAdmin(event)` — redirects to login if not authenticated
- [ ] `+layout.svelte`: admin chrome — sidebar nav, top bar with admin username, sign-out button
  - [ ] Sidebar links: Dashboard, Users, Settings, Audit Log
  - [ ] Use shadcn-svelte `Sidebar` component
  - [ ] Use `{@render children()}` for content slot

### 11.2 — Admin login page (`src/routes/(admin)/login/+page.server.ts` + `+page.svelte`)

- [ ] Note: login route may need to sit outside `(admin)` layout group to avoid auth-guard loop
- [ ] Consider placing at `src/routes/login/+page.svelte`
- [ ] Form action: validate username/password against `admin_accounts`, create session, set cookie
- [ ] Rate-limit login attempts (10 per 15 minutes per IP)
- [ ] On success: redirect to `/dashboard`
- [ ] Append audit log `admin.login`

### 11.3 — Dashboard page (`src/routes/(admin)/dashboard/+page.server.ts` + `+page.svelte`)

- [ ] Load function returns:
  - [ ] Total user count (active/inactive)
  - [ ] Recent sync status
  - [ ] Plex connection health
  - [ ] Dispatcharr connection health
  - [ ] SQLite health
  - [ ] Last sync report summary
  - [ ] "Available" Plex friends not yet onboarded
- [ ] Dashboard UI:
  - [ ] Health status cards (Plex, Dispatcharr, SQLite) with color-coded indicators
  - [ ] User statistics card (total, active, inactive, orphaned)
  - [ ] Recent activity from audit log (last 10 entries)
  - [ ] "Available Plex friends" list with "Invite" action buttons
  - [ ] Next scheduled sync countdown

### 11.4 — Users management page (`src/routes/(admin)/users/+page.server.ts` + `+page.svelte`)

- [ ] Load function: fetch all `user_mappings` with pagination
- [ ] Users table with columns:
  - [ ] Plex avatar + username
  - [ ] Dispatcharr username
  - [ ] Provisioning mode (badge)
  - [ ] Status (active/inactive/orphaned badges)
  - [ ] Last accessed
  - [ ] Actions dropdown
- [ ] Actions per user:
  - [ ] **Rotate credentials** — calls `rotateCredentials()` via form action
  - [ ] **Disable** — calls `disableUser()` via form action
  - [ ] **Enable** — calls `enableUser()` via form action
  - [ ] **Change group** — modal with group selector, submits PUT to Dispatcharr
  - [ ] **Change profile** — modal with profile selector
  - [ ] **View details** — modal showing full mapping info, streaming URLs
- [ ] Filters: status (all/active/inactive/orphaned), provisioning mode, search by username
- [ ] Use shadcn-svelte `Table`, `Badge`, `DropdownMenu`, `Dialog`, `Button`

### 11.5 — Settings page (`src/routes/(admin)/settings/+page.server.ts` + `+page.svelte`)

- [ ] Load function: read all config values (decrypt sensitive ones for display/redaction)
- [ ] Settings sections:
  - [ ] **Plex Connection**: server URL, token (redacted, with "Re-authenticate" button), server info display
  - [ ] **Dispatcharr Connection**: URL, API key (redacted, with "Update" button), connection status
  - [ ] **XC URL Template**: editable template string, "Test" button that runs discovery probe
  - [ ] **Default Provisioning**: default mode selector, default group selector, default profile selector
  - [ ] **Sync Settings**: sync interval (minutes), health check interval (minutes)
  - [ ] **Security**: allowed origins editor, session TTL settings
  - [ ] **Audit Log**: max retention days
- [ ] Each section is a form with its own action
- [ ] Changes write to `config` table, invalidate config cache, append audit log `config.changed`

### 11.6 — Audit log page (`src/routes/(admin)/audit/+page.server.ts` + `+page.svelte`)

- [ ] Load function: query audit log with filters and pagination
- [ ] Audit log table:
  - [ ] Timestamp
  - [ ] Actor
  - [ ] Action (color-coded badge)
  - [ ] Detail (expandable JSON)
  - [ ] IP address
- [ ] Filters: action type dropdown, date range, actor search
- [ ] Pagination controls
- [ ] Use shadcn-svelte `Table`, `Badge`, `Input` (for search), date pickers

---

## Phase 12 — User Portal (`src/routes/(portal)/`)

### 12.1 — Portal layout (`src/routes/(portal)/+layout.server.ts` + `+layout.svelte`)

- [ ] `+layout.server.ts`: call `requireUser(event)` — redirects to portal login if not authenticated
- [ ] `+layout.svelte`: minimal portal chrome — app logo, user avatar + Plex username, sign-out button
  - [ ] Use `{@render children()}` for content

### 12.2 — Portal landing / "Sign in with Plex" (`src/routes/(portal)/+page.server.ts` + `+page.svelte`)

- [ ] If user is already authenticated → show streaming URLs (see 12.3)
- [ ] If not authenticated → show "Sign in with Plex" button
- [ ] Form action for "Sign in with Plex":
  1. Call `initiateOAuth(forwardUrl)` where `forwardUrl = '/auth/plex/callback'`
  2. Store `webLogin` object in server-side memory map
  3. Redirect user to `webLogin.uri`

### 12.3 — Plex OAuth callback (`src/routes/(portal)/auth/plex/+page.server.ts`)

- [ ] Load function:
  1. Retrieve `webLogin` from server-side memory map
  2. Call `completeOAuth(webLogin)` — polls for completion
  3. Extract `PlexIdentity` from result
  4. Verify Plex account is a current friend via `isCurrentFriend()`
  5. If not a friend → return error: "Your Plex account does not have access to this server"
  6. If friend → call `provisionUser()` from `lib/bridge/provisioner`
  7. Create user session, set session cookie
  8. Redirect to portal home with streaming URLs

### 12.4 — Streaming URLs page (portal home, authenticated)

- [ ] Load function:
  - [ ] Get user mapping from `event.locals.user`
  - [ ] Decrypt XC password (for automatic-mode users)
  - [ ] Build streaming URLs via `lib/url/xc.ts`
  - [ ] Fetch channel list for M3U generation (or generate on-demand)
  - [ ] Update `last_accessed_at` on user mapping
- [ ] Portal UI for **automatic-mode** users:
  - [ ] XC URL displayed in a copyable field with "Copy" button
  - [ ] Player API URL in a copyable field
  - [ ] M3U download button (generates `.m3u` file on-demand)
  - [ ] QR code of XC URL for mobile scanning
  - [ ] Platform-specific setup instructions (expandable sections for VLC, TiviMate, Smarters)
  - [ ] "Refresh credentials" button (triggers credential rotation)
- [ ] Portal UI for **self-managed** users:
  - [ ] Message explaining they manage their own Dispatcharr credentials
  - [ ] Link to Dispatcharr web interface
  - [ ] Their Dispatcharr username (display only)
- [ ] Use shadcn-svelte `Card`, `Button`, `Tabs`, `Alert`, `Badge`, `Tooltip`

---

## Phase 13 — API Routes

### 13.1 — Health endpoint (`src/routes/api/health/+server.ts`)

- [ ] `GET /api/health` — public endpoint (no auth required)
- [ ] Returns JSON:
  ```ts
  {
    status: 'ok' | 'degraded' | 'unhealthy',
    checks: {
      plex: { status: string; lastChecked: string },
      dispatcharr: { status: string; lastChecked: string },
      database: { status: string }
    },
    uptime: number,
    version: string
  }
  ```
- [ ] Read health state from scheduler job results

### 13.2 — Internal API endpoints (`src/routes/api/internal/`)

- [ ] `POST /api/internal/sync` — trigger immediate sync (admin auth required)
- [ ] `POST /api/internal/rotate-credentials/[id]` — rotate a specific user's credentials (admin auth required)
- [ ] `GET /api/internal/plex-friends` — return current Plex friend list (admin auth required)
- [ ] All internal endpoints require admin session validation

---

## Phase 14 — Shared Svelte 5 State Modules (`src/lib/state/`)

### 14.1 — Admin session state (`src/lib/state/admin-session.svelte.ts`)

- [ ] Export proxy object pattern (per coding guidelines):
  ```ts
  export const adminSession = $state<{ username: string | null; loggedIn: boolean }>({
    username: null,
    loggedIn: false
  });
  ```
- [ ] Export `setAdminSession()` and `clearAdminSession()` mutator functions
- [ ] Never reassign the exported binding — mutate properties only

### 14.2 — User session state (`src/lib/state/user-session.svelte.ts`)

- [ ] Export proxy object for user portal session
- [ ] Track Plex identity, provisioning mode, active status

### 14.3 — Health status state (`src/lib/state/health.svelte.ts`)

- [ ] Export proxy object for system health indicators
- [ ] Updated by health check job results (passed from server to client via load functions)
- [ ] Use `$state.raw` for large immutable data (e.g., friend lists) to avoid deep-proxy overhead

---

## Phase 15 — Shared UI Components (`src/lib/components/`)

### 15.1 — Application shell components

- [ ] `AppLogo.svelte` — application logo/wordmark
- [ ] `AdminSidebar.svelte` — admin navigation sidebar using shadcn-svelte Sidebar
- [ ] `PortalHeader.svelte` — user portal top bar
- [ ] `HealthBadge.svelte` — color-coded health status indicator
- [ ] `StatusBadge.svelte` — user status badge (active/inactive/orphaned)

### 15.2 — Feature components

- [ ] `CopyableField.svelte` — text field with "Copy to clipboard" button (for streaming URLs)
- [ ] `QRCodeDisplay.svelte` — renders QR code from URL string (client-side generation)
- [ ] `PlexAvatar.svelte` — user avatar from Plex thumb URL with fallback
- [ ] `SetupWizard.svelte` — multi-step wizard container with step indicators
- [ ] `ConfirmDialog.svelte` — confirmation modal for destructive actions (wraps shadcn Dialog)

### 15.3 — Component patterns

- [ ] All components use Svelte 5 runes only (`$props`, `$state`, `$derived`, `$effect`)
- [ ] All components use `interface Props` and `$props<Props>()` for typed props
- [ ] All components use snippets (`Snippet` from `svelte`) instead of slots
- [ ] All components use `cn()` for class composition
- [ ] Follow shadcn-svelte component patterns — `class` prop via `$props`, `{@render children?.()}`

---

## Phase 16 — Root Layout and Error Handling

### 16.1 — Root layout (`src/routes/+layout.svelte`)

- [ ] Minimal root layout:
  ```svelte
  <script lang="ts">
    let { children } = $props();
  </script>
  <div class="page-shell">
    {@render children()}
  </div>
  ```
- [ ] No UnoCSS import here (imported in `hooks.client.ts` per Safari-safe pattern)

### 16.2 — Error page (`src/routes/+error.svelte`)

- [ ] Display error status code and message
- [ ] Use shadcn-svelte `Card` for styling
- [ ] Link back to home/dashboard as appropriate

---

## Phase 17 — Security Hardening

### 17.1 — Cookie configuration

- [ ] Admin session cookie: `secure: true`, `httpOnly: true`, `sameSite: 'strict'`, `path: '/'`, `maxAge: 3600` (1 hour)
- [ ] User session cookie: `secure: true`, `httpOnly: true`, `sameSite: 'lax'` (Plex OAuth callback may be cross-origin), `path: '/'`, `maxAge: 14400` (4 hours)
- [ ] Session sliding refresh: extend on each valid request

### 17.2 — Content Security Policy

- [ ] Set CSP headers via SvelteKit hooks or adapter config
- [ ] Allow scripts from self, styles from self, images from Plex CDN (user avatars)
- [ ] Block inline scripts (may need nonce strategy for SvelteKit hydration)

### 17.3 — Master key rotation CLI

- [ ] Implement `scripts/rotate-key.ts`:
  - [ ] Accept old and new `OTPRAVKARR_SECRET` values
  - [ ] Open database, read all encrypted fields
  - [ ] Decrypt with old key, re-encrypt with new key
  - [ ] Write back to database in a transaction
- [ ] Document in README

### 17.4 — Input validation

- [ ] Use Zod schemas for all form inputs (via Superforms)
- [ ] Validate Dispatcharr API responses defensively with Zod
- [ ] Validate Plex friend list response shape with Zod
- [ ] Sanitize all user-provided strings before database insertion

---

## Phase 18 — Testing Strategy

### 18.1 — Unit tests (Vitest)

- [ ] `src/lib/crypto/__tests__/` — encryption round-trips, key derivation, password hashing, bootstrap tokens
- [ ] `src/lib/db/__tests__/` — repository functions with in-memory SQLite
- [ ] `src/lib/plex/__tests__/` — client wrapper with mocked `@ctrl/plex`
- [ ] `src/lib/dispatcharr/__tests__/` — REST client with mocked `ofetch`
- [ ] `src/lib/bridge/__tests__/` — provisioning and lifecycle logic with mocked dependencies
- [ ] `src/lib/url/__tests__/` — URL generation, M3U output, template substitution
- [ ] `src/lib/server/__tests__/` — CSRF validation, rate limiting
- [ ] `src/lib/scheduler/__tests__/` — job runner with mock jobs

### 18.2 — Component tests (Vitest + Testing Library)

- [ ] Test shadcn-svelte wrapper components render correctly
- [ ] Test `CopyableField` copies to clipboard
- [ ] Test `SetupWizard` step navigation
- [ ] Test form components validate input

### 18.3 — E2E tests (Playwright)

- [ ] `e2e/setup.spec.ts` — full first-run onboarding flow
- [ ] `e2e/admin-login.spec.ts` — admin authentication
- [ ] `e2e/admin-dashboard.spec.ts` — dashboard loads with health data
- [ ] `e2e/admin-users.spec.ts` — user management CRUD
- [ ] `e2e/portal-oauth.spec.ts` — Plex OAuth login flow (mocked Plex endpoints)
- [ ] `e2e/portal-urls.spec.ts` — streaming URL display and copy

---

## Phase 19 — Documentation and Deployment

### 19.1 — README.md

- [ ] Project overview and purpose
- [ ] Prerequisites (Bun ≥ 1.2, Docker optional)
- [ ] Quick start: `bun install`, set `OTPRAVKARR_SECRET`, `bun --bun run dev`
- [ ] Environment variables reference table
- [ ] First-run onboarding instructions
- [ ] Docker deployment instructions
- [ ] Architecture overview referencing PRD
- [ ] API reference (health endpoint)
- [ ] License (AGPL-3.0)

### 19.2 — CONTRIBUTING.md

- [ ] Development setup steps
- [ ] Coding standards reference (link to `bun-svelte-pro.md`)
- [ ] Testing commands (`bun run test`, `bun run test:e2e`)
- [ ] PR guidelines

### 19.3 — Production deployment checklist

- [ ] Set strong `OTPRAVKARR_SECRET` (≥ 32 random bytes, base64 encoded)
- [ ] Configure `ORIGIN` to match actual deployment URL
- [ ] Mount persistent volume for `./data` directory (SQLite file)
- [ ] Place behind reverse proxy with TLS termination
- [ ] Configure reverse proxy to pass `X-Forwarded-For` for rate limiting
- [ ] Set `PROTOCOL_HEADER` and `HOST_HEADER` for adapter-bun behind a proxy
- [ ] Verify bootstrap token appears in container logs on first run
- [ ] Complete setup wizard immediately after first start

---

## Implementation Order Summary

The phases above are ordered by dependency. The recommended implementation sequence:

1. **Phase 0** — Scaffolding (foundation for everything)
2. **Phase 1** — Crypto (everything sensitive depends on this)
3. **Phase 2** — Database (persistence layer for all features)
4. **Phase 9** — Server hooks (setup gate enables all subsequent routing work)
5. **Phase 7** — Server utilities (auth guards, CSRF, rate limiting)
6. **Phase 3** — Plex integration
7. **Phase 4** — Dispatcharr integration
8. **Phase 5** — URL generation
9. **Phase 6** — Bridge logic (orchestrates Phases 3-5)
10. **Phase 8** — Scheduler (depends on bridge logic)
11. **Phase 10** — Setup wizard (first user-facing feature; exercises Phases 1-7)
12. **Phase 11** — Admin dashboard
13. **Phase 12** — User portal
14. **Phase 13** — API routes
15. **Phase 14-16** — Shared state, components, layout
16. **Phase 17** — Security hardening
17. **Phase 18** — Testing (tests written alongside each phase, full suite assembled here)
18. **Phase 19** — Documentation and deployment

---

## Appendix A — Config Keys Reference

| Config Key | Encrypted | Description |
|---|---|---|
| `plex_server_url` | No | Plex server base URL |
| `plex_admin_token` | Yes | Plex admin auth token |
| `plex_machine_id` | No | Machine identifier for server-change detection |
| `dispatcharr_url` | No | Dispatcharr instance base URL |
| `dispatcharr_api_key` | Yes | Dispatcharr API key |
| `default_group_id` | No | Default Dispatcharr group ID for new users |
| `default_profile_id` | No | Default channel profile ID (nullable) |
| `default_provisioning_mode` | No | `automatic` or `self_managed` |
| `sync_interval_minutes` | No | Sync job interval (default: 15) |
| `health_interval_minutes` | No | Health check interval (default: 5) |
| `allowed_origins` | No | JSON array of allowed CSRF origins |
| `xc_url_template` | No | Configurable XC URL template |
| `admin_session_ttl_seconds` | No | Admin session TTL (default: 3600) |
| `user_session_ttl_seconds` | No | User session TTL (default: 14400) |
| `audit_retention_days` | No | Audit log max age (default: 90) |

## Appendix B — Upstream API Endpoint Usage Map

### Plex (`@ctrl/plex`) — per `docs/ctrl-plex-api-docs.md`

| Operation | Method / Class | Import |
|---|---|---|
| Server token validation | `new PlexServer(url, token).connect()` | `PlexServer` from `@ctrl/plex` |
| OAuth: initiate | `MyPlexAccount.getWebLogin(forwardUrl)` (static) | `MyPlexAccount` from `@ctrl/plex` |
| OAuth: complete | `MyPlexAccount.webLoginCheck(webLogin, opts)` (static) | `MyPlexAccount` from `@ctrl/plex` |
| Server discovery | `account.resources()` → `resource.connect()` | via `MyPlexAccount` instance |
| Server identity | `PlexServer.machineIdentifier`, `.friendlyName` | via `PlexServer` instance |
| Friend list | `account.query({ url: 'https://plex.tv/api/v2/friends', method: 'get' })` | via `MyPlexAccount` instance |
| Error handling | Catch `Unauthorized`, `BadRequest`, `NotFound` | from `@ctrl/plex` |

### Dispatcharr REST API — per `docs/dispatcharr-api-docs.md`

| Operation | Endpoint | Method | Auth |
|---|---|---|---|
| Health/connectivity | `/api/accounts/users/?page=1&page_size=1` | GET | `Authorization: ApiKey <key>` |
| Create user | `/api/accounts/users/` | POST | ApiKey |
| Get user | `/api/accounts/users/{id}/` | GET | ApiKey |
| Update user | `/api/accounts/users/{id}/` | PUT | ApiKey |
| Delete user | `/api/accounts/users/{id}/` | DELETE | ApiKey |
| List groups | `/api/accounts/groups/` | GET | ApiKey |
| List profiles | `/api/channels/profiles/` | GET | ApiKey |
| List channels | `/api/channels/channels/` | GET | ApiKey |
| Channel streams | `/api/channels/channels/{id}/streams/` | GET | ApiKey |
