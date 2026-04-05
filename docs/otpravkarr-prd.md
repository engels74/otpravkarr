# otpravkarr — High-Level Architecture

> **Status:** Draft v0.2 — Qualified against `@ctrl/plex` and Dispatcharr REST API documentation
> **License:** AGPL-3.0
> **Last updated:** 2026-04-05

---

## 1. What This Is

otpravkarr is a bridge application that connects a Plex media server's user base to a Dispatcharr IPTV management instance. It solves a specific gap: Dispatcharr excels at managing IPTV channels, EPG data, and XC-compatible streaming — but has no awareness of Plex users. Plex knows its users but offers no flexible way to share live TV channels beyond home/managed users. otpravkarr sits between them, automatically provisioning Dispatcharr streaming accounts for verified Plex users and generating ready-to-use streaming URLs.

---

## 2. Tech Stack

| Layer             | Technology                                         | Rationale                                                                 |
|-------------------|----------------------------------------------------|---------------------------------------------------------------------------|
| Runtime           | Bun                                                | Single binary, native SQLite, fast startup, TS-first                      |
| Framework         | SvelteKit (Svelte 5+)                              | SSR + SPA hybrid, file-based routing, server hooks for auth               |
| UI components     | shadcn-svelte                                      | Accessible, composable, unstyled primitives                               |
| CSS               | UnoCSS (Wind4 preset, Tailwind v4/v5 compat)       | On-demand atomic CSS, fast builds, zero runtime                           |
| Database          | Bun's built-in SQLite (`bun:sqlite`)               | Zero-dependency, embedded, sufficient for the dataset                     |
| Plex client       | `@ctrl/plex`                                       | Typed TS Plex API client, covers OAuth + server queries                   |
| Dispatcharr client| Custom typed REST client (built on `ofetch`)        | `ofetch` is already a transitive dep; no existing TS client for Dispatcharr|
| Language          | TypeScript (100%, strict mode)                     | End-to-end type safety, no JS escape hatches                              |

---

## 3. Runtime Model

One Bun process. One port. One SQLite file.

The application is a single SvelteKit server that handles three concerns:

1. **HTTP layer** — serves the admin dashboard, the user portal, and internal API routes
2. **Background services** — sync jobs, health probes, and credential lifecycle run as in-process scheduled tasks (no external job queue, no Redis, no cron)
3. **Persistence** — all state lives in a single SQLite database file, with field-level encryption for sensitive values

Deployment is a single Docker container or a bare `bun run build && bun run start`. No orchestration required.

Request-scoped auth and health remain server-authoritative. Admin/user identity is resolved in `hooks.server.ts` and exposed through `event.locals` plus server `load` functions, while health is produced by in-process scheduler jobs. Any shared Svelte 5 state modules under `src/lib/state/` are client-side mirrors hydrated from `load` data for extracted UI components; they do not replace auth guards, `event.locals`, or scheduler-owned state.

---

## 4. First-Run Onboarding & Bootstrap Security

The application has a distinct first-run state: no admin account exists, no configuration has been set, and the instance must be claimed by its rightful operator. This is a critical security boundary.

### 4.1 Bootstrap Token

On first startup, when the database is empty (no admin account exists), the application:

1. Generates a cryptographically random single-use **bootstrap token**
2. Prints it to stdout/logs in a clearly formatted block with a short guide:
   - The raw token for manual entry
   - A ready-to-copy URL: `http://<host>:<port>/setup?token=xxxx-xxxx-xxxx`
   - A note that this token is single-use and expires after a configurable window (default: 15 minutes)
3. Locks the entire application behind a setup gate — every route except `/setup` and its static assets returns a redirect or a 403

### 4.2 Setup Flow

The `/setup` route accepts the bootstrap token (via query param or manual paste into a form field) and walks the admin through initial configuration:

1. **Claim the instance** — the admin submits the bootstrap token, proving they have access to the process logs (i.e., they own the server)
2. **Create admin account** — username + password for the otpravkarr dashboard (password hashed with argon2id)
3. **Configure Plex connection** — the admin provides a Plex authentication token. otpravkarr instantiates a `PlexServer` using that token and the admin-provided server URL, calls `connect()` to load server metadata, and validates the connection by checking that properties like `friendlyName` and `machineIdentifier` are populated. If the server is reachable and the token carries owner-level access, the step succeeds. The admin can alternatively use Plex OAuth: otpravkarr calls the static `MyPlexAccount.getWebLogin()` to generate a login URI, the admin completes the flow in-browser, and `MyPlexAccount.webLoginCheck()` returns the authenticated account. From there, otpravkarr calls `account.resources()` to list available servers and presents them for selection. The admin picks the target server and otpravkarr calls `resource.connect()` to obtain a `PlexServer` handle. The resulting `authenticationToken` from the account is persisted (encrypted) as the long-lived Plex credential.
4. **Configure Dispatcharr connection** — the admin provides the Dispatcharr instance URL and an API key. otpravkarr validates the connection by issuing a GET request to `/api/accounts/users/` using the `Authorization: ApiKey <key>` header. A successful paginated response confirms the key is valid and has admin-level access. If the Dispatcharr instance has not yet been initialized (no users exist), the admin is informed that they must first create a superuser via Dispatcharr's own `/api/accounts/initialize-superuser/` endpoint before connecting otpravkarr.
5. **Configure origin / CSRF** — the admin specifies the allowed origin(s) for the instance (e.g., `https://otpravkarr.example.com`). This is used for CSRF origin checking on all subsequent requests. Auto-suggested from the current request's origin, but explicitly confirmed by the admin.
6. **Set defaults** — default Dispatcharr user group (selected from the list returned by GET `/api/accounts/groups/`), default channel profile (selected from GET `/api/channels/profiles/`, or "all channels" if null), sync interval, and default user provisioning mode (automatic or admin-approval).

Once setup completes:

- The bootstrap token is invalidated permanently (deleted from memory and any stored reference)
- The setup route becomes inaccessible (returns 404) until the database is wiped
- CSRF origin validation is active for all state-mutating requests
- The admin is logged in and redirected to the dashboard

### 4.3 Anti-Hijack Guarantees

- The bootstrap token exists only in memory and logs — never in the database, never in a config file
- If the token expires unused, a new one is generated and printed on the next restart
- The setup endpoint is rate-limited (5 attempts max) to prevent brute-force even on a LAN
- After a successful claim, the setup route is gone — there is no "re-onboard" path without wiping the database

---

## 5. Module Decomposition

Each module has a single responsibility and well-defined boundaries. Modules communicate through typed interfaces, not direct imports of each other's internals.

### `lib/plex`

Plex integration wrapper. Consumes `@ctrl/plex` and exposes only what the app needs:

- **Token validation.** Instantiate a `PlexServer` with the configured URL and token, call `connect()`, and assert that server metadata loads without an `Unauthorized` error. The `@ctrl/plex` library throws typed errors — `Unauthorized` on 401, `BadRequest` on 400, `NotFound` on 404 — so otpravkarr catches these specifically rather than treating all failures the same way.
- **Plex OAuth flows.** `MyPlexAccount.getWebLogin(forwardUrl)` is a static method that returns a `WebLogin` object containing a `uri` (the URL to present to the user in a browser) and an internal identifier. `MyPlexAccount.webLoginCheck(webLogin, options)` is the corresponding static polling method — it checks whether the user completed the login flow and returns a fully connected `MyPlexAccount` on success, or throws if the timeout (configurable via `timeoutSeconds`) elapses. The returned account exposes `id`, `uuid`, `email`, `username`, `thumb`, and `authenticationToken` — all the identity fields otpravkarr needs to create or look up a user mapping.
- **Friend and shared-user enumeration.** This is the module's most nuanced responsibility. The `PlexServer.systemAccounts()` method returns `SystemAccount` objects, but these represent every account that has ever interacted with the server — including the owner, managed/home users, and accounts that may have been removed from sharing. These records are server-local and lack the sharing-relationship metadata otpravkarr needs (whether the user is currently a friend/shared user with active library access). The reliable approach is to use `MyPlexAccount.query()` to issue a GET request against the plex.tv sharing API (the `/api/v2/friends` or equivalent endpoint on `plex.tv`) using the admin's `authenticationToken`. This returns the canonical list of accounts with an active sharing relationship. The `query()` method on `MyPlexAccount` accepts a URL, HTTP method, and optional headers, making it suitable for hitting plex.tv endpoints that `@ctrl/plex` does not wrap with dedicated methods. The response shape (an array of friend objects with account IDs, usernames, emails, and thumbs) must be validated defensively since this endpoint is not formally typed by the library.
- **Single-user verification.** Given a Plex account ID obtained from an OAuth callback, verify it appears in the current friends list. This is a simple filter over the enumeration result, cached for the duration of a sync cycle.

Does not touch Dispatcharr or the database. Speaks only Plex concepts.

### `lib/dispatcharr`

Typed REST client for the Dispatcharr API. Built on `ofetch`. Authenticates all requests using the `Authorization: ApiKey <key>` header (preferred over the `X-API-Key` alternative for consistency). Covers the endpoint subset the app uses:

- **User CRUD.** Maps to the `/api/accounts/users/` resource. Creating a user requires a POST with `username` (string, required), `password` (string, required on create), and optionally `email`, `is_staff` (boolean, defaults to false), `is_active` (boolean, defaults to true), and `groups` (an array of group IDs). Retrieving a user is a GET to `/api/accounts/users/{id}/`. Updating a user (to change group membership, active status, or email) is a PUT to the same path. "Disabling" a user means issuing a PUT with `is_active` set to false — there is no dedicated disable endpoint. Deleting a user is a DELETE to `/api/accounts/users/{id}/`, but otpravkarr should prefer deactivation over deletion to preserve audit trails.
- **Group listing and assignment.** GET `/api/accounts/groups/` returns all groups with their `id`, `name`, and `permissions` array. When creating a Dispatcharr user, the `groups` field on the user payload accepts an array of these group IDs. otpravkarr fetches the group list during setup and sync to let the admin assign a default group. The group model in Dispatcharr is permission-scoped, not role-typed — there is no "streamer" or "standard" group by default. The admin must create the appropriate groups in Dispatcharr first, and otpravkarr references them by ID.
- **Channel profile listing and membership management.** GET `/api/channels/profiles/` returns available profiles. Each profile controls which channels are visible to its members. otpravkarr uses the profile ID as a per-user or per-group assignment. The PUT endpoint at `/api/channels/profiles/{id}/channels/{channel_id}/` toggles individual channel membership, and POST `/api/channels/profiles/{id}/channels/bulk-update/` accepts a `memberships` array of `{channel_id, enabled}` pairs for batch operations. otpravkarr does not manage profile content (which channels are in a profile) — that is the admin's responsibility in Dispatcharr. otpravkarr only assigns users to profiles.
- **Channel listing.** GET `/api/channels/channels/` returns the paginated channel list. This is needed for M3U playlist generation — otpravkarr iterates through channels (handling pagination via the `page` and `page_size` query parameters, following the `next` URL in paginated responses) to build per-user playlists with baked-in credentials.
- **Health and connectivity check.** A lightweight GET to `/api/accounts/users/?page=1&page_size=1` serves as the health probe. A 200 response with a valid paginated envelope confirms the instance is reachable and the API key is valid. A 401 indicates the key has been revoked or rotated. A network error or 500 indicates the instance is down.

Does not touch Plex or the database. Speaks only Dispatcharr concepts. The client wraps every response in a result type that distinguishes success, authentication failure, network error, and unexpected response shape — no raw exceptions leak to callers.

**Important design constraint:** Dispatcharr's API follows Django REST Framework conventions. All list endpoints return paginated responses with `count`, `next`, `previous`, and `results` fields. The client must handle pagination generically rather than assuming all results fit on one page. The default page size is 50 and the maximum is 10,000 for streams.

### `lib/bridge`

Core domain logic — the application's reason to exist. Orchestrates between Plex and Dispatcharr:

- **Provisioning.** Given a Plex identity (account ID, username, email, thumb URL) obtained from the OAuth flow, the bridge checks the local database for an existing mapping. If none exists, it calls into `lib/dispatcharr` to POST a new user to `/api/accounts/users/` with a generated username (derived from the Plex username, sanitized for uniqueness), a cryptographically random password (generated by `lib/crypto`), `is_staff` set to false, `is_active` set to true, and the configured default group ID in the `groups` array. The Dispatcharr API returns the created user object including its numeric `id`. The bridge stores the mapping (Plex account ID → Dispatcharr user ID) along with the encrypted password in the local database. If the admin has configured a channel profile, the bridge then assigns the new Dispatcharr user to that profile — this is an application-level association stored in the local database and reflected in URL generation, since Dispatcharr profiles operate at the channel-visibility level rather than the user level.
- **Credential lifecycle.** For provisioned users, the XC password is stored encrypted (AES-256-GCM via `lib/crypto`) because it must be recoverable for URL generation. Password rotation means generating a new random password, PUTting the updated password to `/api/accounts/users/{id}/` on Dispatcharr, and re-encrypting the new value locally. Revocation means PUTting `is_active: false` on the Dispatcharr user and marking the local mapping as inactive.
- **User type routing.** The original architecture described three "user types" (streamer, standard, admin). After reviewing the Dispatcharr API, this concept needs refinement. Dispatcharr does not have a native user-type taxonomy — it has `is_staff` (boolean) and group-based permissions. otpravkarr maps its logical user types as follows:

| otpravkarr Concept | Dispatcharr Mapping | XC Password | Dispatcharr Web Access | otpravkarr Behavior |
|---|---|---|---|---|
| **Automatic** (default) | `is_staff: false`, assigned to default group | Auto-generated, stored encrypted in otpravkarr | No meaningful access (non-staff user with no Dispatcharr UI role) | Fully automatic. User sees streaming URLs immediately after Plex OAuth |
| **Self-managed** | `is_staff: false`, assigned to default group | User-chosen during onboarding. otpravkarr creates the Dispatcharr account with a temporary password, then directs the user to change it via Dispatcharr. otpravkarr does not store the final password | Full web access as a standard user | After Plex OAuth, user is guided to set their own Dispatcharr password. otpravkarr stores only the mapping, not the credential |
| **Staff** | `is_staff: true`, assigned to admin group | User-chosen | Full staff-level access | Same as self-managed but with elevated Dispatcharr privileges. Intended for co-admins. Rare |

- **URL templating.** Delegates to `lib/url` for format specifics. Passes the Dispatcharr host, the generated username, and the decrypted XC password.

Calls into `lib/plex`, `lib/dispatcharr`, `lib/db`, and `lib/crypto`. Those modules do not know `lib/bridge` exists.

### `lib/db`

Database layer. Owns:

- Schema definition and versioned migrations (plain SQL files, applied on startup)
- Typed repository functions (`getUserMapping`, `createUserMapping`, `rotateCredentials`, `getConfig`, `appendAuditLog`, etc.)
- Prepared statement management
- Encrypted field read/write (delegates actual crypto to `lib/crypto`)

No business logic. No query building at the call site. Uses `bun:sqlite` directly with prepared statements.

### `lib/crypto`

Isolated cryptographic utilities:

- Master key derivation from `otpravkarr_SECRET` env var via HKDF, producing purpose-specific subkeys
- Field-level authenticated encryption (AES-256-GCM) for sensitive database values (Plex token, Dispatcharr API key, XC passwords)
- XC password generation (cryptographically random, configurable length/charset, default 24 chars alphanumeric)
- Admin password hashing (argon2id)
- Bootstrap token generation

Stateless, auditable, no side effects.

### `lib/scheduler`

Lightweight in-process job runner:

- `setInterval`-based with drift correction and overlap guards (if a job is still running, skip the next tick)
- Runs: Plex↔Dispatcharr sync, upstream health checks, stale session cleanup, audit log rotation
- Jobs are registered declaratively; each job is a plain async function with a name and interval

No cron library, no external dependencies.

### `lib/url`

Pure functions for URL and playlist generation:

- XC-format URL construction (see Section 9 for details and caveats)
- Direct M3U file body with `#EXTINF` entries and baked-in credentials, built by iterating the channel list obtained from GET `/api/channels/channels/` via `lib/dispatcharr`
- Platform-specific variants (VLC, TiviMate, etc.) as needed
- QR code data URIs for mobile setup (pure generation, no server round-trip)

No side effects, no network calls. Takes credentials + config + channel list in, returns strings out.

### `lib/state`

Client-side shared Svelte 5 state modules for extracted UI and layout-group composition:

- Mirror small server-derived snapshots such as current admin identity, current portal user identity, or current dashboard health data
- Hydrate from `+layout.svelte` / `+page.svelte` using existing `load` output
- Reduce prop drilling across extracted components inside a single client tree when plain props become awkward

These modules are never the source of truth for authentication, authorization, or scheduler results. Do not use them to carry request-specific data across requests, and do not import them into `hooks.server.ts` or `+*.server.ts` as an authority layer.

### `lib/server`

Shared server-side utilities:

- Auth guards (admin session check, user session check, setup-gate check)
- CSRF origin validation middleware (configured during onboarding)
- Rate limiting (in-memory, per-route)
- Secure cookie/session configuration
- Request logging

Used by SvelteKit's `hooks.server.ts` and API route handlers.

---

## 6. Authentication & Identity

Two distinct auth contexts, strictly separated.

### 6.1 Admin Auth

- Authenticates via local username/password (created during onboarding)
- Password stored as argon2id hash in SQLite
- Session: secure, httpOnly, sameSite cookie containing a short-lived JWT
- Managed in SvelteKit's `hooks.server.ts`
- Has full access to all settings, user mappings, audit logs, and system health
- Client-side admin UI may mirror the current username for presentation, but `hooks.server.ts`, `event.locals.admin`, and `requireAdmin()` remain authoritative

### 6.2 User Auth

- Authenticates exclusively via Plex OAuth
- Flow:
  1. User visits the otpravkarr portal, clicks "Sign in with Plex"
  2. otpravkarr calls the static `MyPlexAccount.getWebLogin(forwardUrl)`, where `forwardUrl` points back to otpravkarr's Plex OAuth callback route. This returns a `WebLogin` object with a `uri` property — the URL the user must visit to complete the Plex login
  3. The user is redirected to `webLogin.uri` in their browser. After completing the Plex login, otpravkarr calls `MyPlexAccount.webLoginCheck(webLogin, { timeoutSeconds: 120 })` to poll for completion. On success, this returns a fully connected `MyPlexAccount` instance
  4. otpravkarr reads the account's `id`, `username`, `email`, and `thumb` properties from the returned `MyPlexAccount`. These are the user's Plex identity fields
  5. otpravkarr verifies this Plex account ID is a current friend/shared user on the admin's configured server (see `lib/plex` friend enumeration above)
  6. If valid → `lib/bridge` provisions or retrieves their Dispatcharr account
  7. User sees their portal with ready-to-use streaming URLs
- Users never create a password on otpravkarr. Their identity is their Plex identity
- The only password associated with them (for "automatic" type users) is the auto-generated XC credential on Dispatcharr, which they never type — they just copy a URL
- Client-side portal UI may mirror the current Plex identity for presentation, but `event.locals.user`, `requireUser()`, and server `load` functions remain authoritative

### 6.3 Dispatcharr Account Provisioning Modes

Configurable per-instance (default: automatic). See the user type routing table in Section 5 (`lib/bridge`) for the full mapping.

The key design point: Dispatcharr's user model is simple — `username`, `password`, `email`, `is_staff`, `is_active`, and `groups`. There is no built-in concept of a "streamer" user or a restricted account type. The differentiation between a user who gets a fully automatic XC experience and one who manages their own Dispatcharr credentials is entirely a otpravkarr-level concern, enforced by whether otpravkarr generates and stores the password or defers to the user.

---

## 7. Data Model

Minimal schema — stores only what cannot be derived at runtime.

### `config`

Key-value store for runtime settings:

- Dispatcharr URL, API key (encrypted), default user group ID, default channel profile ID, sync interval, allowed origins (CSRF)
- Plex server URL, Plex admin token (encrypted), Plex server machine identifier (used to detect if the admin reconnects to a different server)
- Default provisioning mode (`automatic` | `self_managed`), default `is_staff` value (boolean, typically false)
- Sensitive values encrypted at rest via `lib/crypto`
- Read into memory on startup; writes flush to disk and update in-memory cache

### `user_mappings`

The bridge table. One row per Plex↔Dispatcharr user link:

- `plex_account_id` — Plex's immutable numeric account ID (the `id` property from `MyPlexAccount`). This is the primary key of truth
- `plex_uuid` — Plex's account UUID (the `uuid` property from `MyPlexAccount`). Stored as a secondary identifier for cross-referencing
- `plex_username` — display-only, synced periodically. Sourced from `MyPlexAccount.username`
- `plex_email` — display-only, synced periodically. Sourced from `MyPlexAccount.email`
- `plex_thumb` — avatar URL, display-only. Sourced from `MyPlexAccount.thumb`
- `dispatcharr_user_id` — the numeric `id` returned by Dispatcharr's POST `/api/accounts/users/` response
- `dispatcharr_username` — the generated Dispatcharr username (must be unique within Dispatcharr)
- `dispatcharr_xc_password_enc` — encrypted XC password (only for "automatic" mode users; null for "self-managed" users whose password otpravkarr does not retain)
- `dispatcharr_group_ids` — JSON array of Dispatcharr group IDs assigned to this user (mirrors the `groups` field on the Dispatcharr user object)
- `dispatcharr_profile_id` — assigned channel profile ID (nullable; null = all channels). References a profile from `/api/channels/profiles/`
- `provisioning_mode` — `automatic` | `self_managed` | `staff`
- `is_active` — whether the mapping is active (mirrors the `is_active` field on the Dispatcharr user)
- `created_at`, `updated_at`, `last_synced_at`, `last_accessed_at` — timestamps

### `sessions`

Admin and user sessions:

- Session ID, user reference, type (admin/user), expiry
- Short TTL, cleaned up by the scheduler

### `audit_log`

Append-only log of significant events:

- Timestamp, actor (admin or user ID), action type, detail (JSON), IP address
- Action types: `user.provisioned`, `user.disabled`, `user.credentials_rotated`, `sync.completed`, `config.changed`, `admin.login`, `setup.completed`, etc.
- No delete endpoint. Rotation/archival is a file-level concern (configurable max age)

### Migrations

Versioned SQL files in `lib/db/migrations/`, named sequentially (`001_initial.sql`, `002_add_profiles.sql`, etc.). Applied automatically on startup. Forward-only — no down migrations (keep it simple; for a self-hosted app, rollback = restore from backup).

---

## 8. Sync & Lifecycle

A reconciliation loop runs on a configurable interval (default: 15 minutes).

### Sync Steps

1. **Fetch** the current shared/friend user list from the Plex server. This uses `MyPlexAccount.query()` to call the plex.tv friends/sharing API (not `PlexServer.systemAccounts()`, which returns a broader and less reliable set — see `lib/plex` notes above). Each friend record includes the Plex account ID, username, email, and thumb URL.
2. **Compare** against `user_mappings` in the database.
3. **New Plex users** (on Plex's friend list but not in otpravkarr) — do not auto-provision. Flag them as "available" in the admin dashboard so the admin sees who could be onboarded. Provisioning happens on first Plex OAuth login by the user (or manual admin action).
4. **Removed Plex users** (in otpravkarr but no longer on Plex's friend list) — disable the Dispatcharr account by issuing a PUT to `/api/accounts/users/{id}/` with `is_active: false`. Mark the local mapping as inactive. Create an audit log entry. The admin can re-enable if the user is re-added to Plex.
5. **Existing users** — verify the Dispatcharr account still exists by issuing a GET to `/api/accounts/users/{id}/`. If the API returns 404, the account was externally deleted (or Dispatcharr was reset); flag the mapping as "orphaned" for admin attention. If the account exists, compare its `groups` array and `is_active` status against the local mapping and reconcile any drift.
6. **Plex identity refresh** — for existing mappings, update the locally cached `plex_username`, `plex_email`, and `plex_thumb` from the friend list data, since Plex users can change their display name and email.
7. **Write** sync results to the audit log.

### Health Checks

Separate from sync, on a shorter interval (default: 5 minutes):

- **Plex health:** Instantiate a `PlexServer` with the stored URL and token, call `connect()`. If the connection succeeds and `machineIdentifier` matches the stored value, the server is healthy. If it throws `Unauthorized`, the token has been revoked. If it throws a network error, the server is unreachable. If `machineIdentifier` differs, the admin has pointed the URL at a different server (flag for attention).
- **Dispatcharr health:** GET `/api/accounts/users/?page=1&page_size=1` with the stored API key. A 200 confirms the instance is up and the key is valid. A 401 means the key was revoked. A network error means the instance is down.
- **SQLite health:** Attempt a simple write-and-read cycle to confirm the database is not locked or corrupted.

Results exposed on the admin dashboard and via a `/api/health` endpoint.
Client-side dashboard components may mirror a health snapshot after a `load` function runs, but the scheduler job state remains the source of truth.

---

## 9. URL Generation

`lib/url` produces output in several formats. **This section carries a significant caveat** — see the note on XC surface discovery below.

### XC-Format (Default)

The standard Xtream Codes API URL format:

`http(s)://{dispatcharr_host}/get.php?username={xc_user}&password={xc_pass}&type=m3u_plus`

This is the primary output. Ready to paste into VLC, TiviMate, or any XC-compatible player.

### Direct M3U Download

A `.m3u` / `.m3u8` file with `#EXTINF` entries and credentials baked into each stream URL. Generated on-demand by querying Dispatcharr's channel list via GET `/api/channels/channels/` (paginating through all results), and templating each channel's XC stream URL. Each `#EXTINF` line includes the channel name, number, and logo URL (from the channel's associated logo via the `/api/channels/logos/` data). Each stream URL follows the standard XC live-stream path format.

### Platform-Specific Variants

Pre-formatted for specific players (VLC, TiviMate, IPTV Smarters, etc.) where URL structure or parameters differ. Pure string templating over the same base credentials.

### QR Codes

Client-side generated QR codes encoding the XC URL, for quick mobile setup. No server round-trip; generated in the browser from the already-available URL string.

### XC Surface Discovery (Critical Implementation Note)

The Dispatcharr REST API documentation does not expose or describe the XC-protocol endpoints directly. The documented API covers channel, stream, EPG, user, and VOD management — but the actual XC-compatible player-facing surface (the `/get.php`, `/player_api.php`, `/live/{user}/{pass}/{channel}.ts` paths that IPTV players connect to) is served by a separate subsystem. The Dispatcharr docs reference two undocumented modules — HDHomeRun at `/api/hdhr/` and Connect at `/api/connect/` — but neither is detailed.

This means the URL format in `lib/url` must be validated against a running Dispatcharr instance before it can be considered reliable. The implementation plan:

1. **Discovery probe on setup.** During the Dispatcharr configuration step of onboarding, after validating the API key, otpravkarr should attempt a GET against common XC paths on the Dispatcharr host (the `get.php` and `player_api.php` convention) with dummy or newly created test credentials. If a recognizable XC response comes back, the URL format is confirmed.
2. **Configurable URL template.** If the standard XC paths do not resolve, the admin can manually specify the URL template via a settings field. This makes otpravkarr resilient to Dispatcharr using custom paths or a reverse proxy that remaps them.
3. **Connect API investigation.** The `/api/connect/` module may be the key — it could be the endpoint that provides the XC-compatible player surface. The Swagger UI at the Dispatcharr instance should be consulted directly for its schema. otpravkarr's `lib/dispatcharr` client should attempt to enumerate this endpoint's capabilities during setup and expose what it finds.

Until this discovery is complete, the URL generation module should treat the XC path format as a configurable template rather than a hardcoded assumption.

---

## 10. Security Model

### 10.1 Encryption at Rest

- A master secret (`otpravkarr_SECRET` env var) is required at startup
- HKDF derives purpose-specific subkeys from the master secret (one for config encryption, one for credential encryption, etc.)
- All sensitive database fields use AES-256-GCM authenticated encryption
- Rotating the master secret is possible via a CLI command that re-encrypts all fields

### 10.2 Password Handling

- Admin password: argon2id hash, never reversible
- XC passwords (automatic-mode users): encrypted (not hashed) because they must be recoverable for URL generation. Stored in `dispatcharr_xc_password_enc` with AES-256-GCM
- Self-managed/staff Dispatcharr passwords: never stored by otpravkarr. The password is generated temporarily for the initial POST to `/api/accounts/users/` (since the `password` field is required on create), then the user is directed to change it. The temporary password is discarded from otpravkarr's memory immediately after the Dispatcharr API confirms creation
- Dispatcharr API key: encrypted at rest in the `config` table, decrypted into memory on startup

### 10.3 Transport & Session Security

- CSRF: origin-based validation configured during onboarding, enforced on all state-mutating requests via `hooks.server.ts`
- Cookies: `secure`, `httpOnly`, `sameSite=strict` (or `lax` if cross-origin Plex OAuth callback requires it — the `forwardUrl` passed to `MyPlexAccount.getWebLogin()` determines whether the callback is same-origin or cross-origin)
- Sessions: short-lived JWTs (admin: 1h, user: 4h), with sliding refresh
- Rate limiting: in-memory per-route, focused on auth endpoints and the setup flow

### 10.4 Bootstrap Security

- Single-use token printed to logs on first run
- Setup endpoint rate-limited to 5 attempts
- Token expires after 15 minutes (configurable)
- After successful onboarding, setup route returns 404 permanently
- No re-onboard path without database wipe

### 10.5 Audit Trail

- All significant actions logged with timestamp, actor, action type, detail, and IP
- Append-only — no programmatic deletion
- Queryable from the admin dashboard with filters

---

## 11. Project Structure

```
src/
├── lib/
│   ├── plex/               # Plex client wrapper
│   │   ├── client.ts           # PlexClient class (wraps @ctrl/plex PlexServer + MyPlexAccount)
│   │   ├── oauth.ts            # OAuth flow helpers (getWebLogin, webLoginCheck wrappers)
│   │   ├── friends.ts          # Friend/shared-user enumeration via plex.tv API
│   │   └── types.ts            # Plex-specific type definitions (PlexFriend, PlexIdentity, etc.)
│   ├── dispatcharr/        # Dispatcharr REST client
│   │   ├── client.ts           # DispatcharrClient class (ofetch, ApiKey auth header)
│   │   ├── endpoints/          # Per-resource endpoint methods (users, groups, profiles, channels)
│   │   ├── pagination.ts       # Generic paginated-response iterator (handles count/next/results)
│   │   └── types.ts            # Dispatcharr-specific type definitions (mirroring API field shapes)
│   ├── bridge/             # Core domain logic
│   │   ├── provisioner.ts      # User provisioning orchestration
│   │   ├── lifecycle.ts        # Sync, disable, re-enable, orphan detection logic
│   │   └── types.ts            # Bridge domain types (ProvisioningMode, UserMapping, etc.)
│   ├── db/                 # SQLite persistence
│   │   ├── connection.ts       # Database initialization and connection
│   │   ├── repositories/       # Typed repository modules (users, config, audit)
│   │   ├── migrations/         # Versioned SQL migration files
│   │   └── types.ts            # Database row types
│   ├── crypto/             # Cryptographic utilities
│   │   ├── encryption.ts       # AES-256-GCM field encryption
│   │   ├── keys.ts             # HKDF key derivation
│   │   ├── passwords.ts        # XC password gen, argon2id hashing
│   │   └── bootstrap.ts        # Bootstrap token generation
│   ├── scheduler/          # Background job runner
│   │   ├── runner.ts           # Interval-based job scheduler
│   │   └── jobs/               # Individual job definitions (sync, health, cleanup)
│   ├── url/                # URL & playlist generation (pure functions)
│   │   ├── xc.ts               # XC-format URL generation (template-based, configurable path)
│   │   ├── m3u.ts              # M3U playlist generation (consumes channel list from lib/dispatcharr)
│   │   ├── platforms.ts        # Platform-specific variants
│   │   └── discover.ts         # XC surface discovery probe (used during setup)
│   ├── state/              # Client-side shared state mirrors for extracted UI
│   └── server/             # Shared server utilities
│       ├── auth.ts             # Auth guards (admin, user, setup-gate)
│       ├── csrf.ts             # CSRF origin validation
│       ├── ratelimit.ts        # In-memory rate limiting
│       └── logging.ts          # Request logging
├── routes/
│   ├── setup/              # First-run onboarding (conditionally active)
│   │   └── +page.svelte
│   ├── (admin)/            # Admin dashboard (layout group, admin auth guard)
│   │   ├── +layout.svelte
│   │   ├── dashboard/
│   │   ├── users/
│   │   ├── settings/
│   │   └── audit/
│   ├── (portal)/           # User-facing portal (layout group, Plex auth guard)
│   │   ├── +layout.svelte
│   │   ├── +page.svelte        # Streaming URLs, m3u downloads, QR codes
│   │   └── auth/
│   │       └── plex/           # Plex OAuth callback handling
│   └── api/                # API routes
│       ├── health/
│       └── internal/           # Internal endpoints (webhook receivers, etc.)
├── components/             # Shared Svelte 5 UI components
├── app.html
├── hooks.server.ts         # SvelteKit server hooks (auth, CSRF, setup-gate)
└── hooks.client.ts         # SvelteKit client hooks (if needed)
```

Two SvelteKit layout groups (`(admin)` and `(portal)`) enforce different auth guards, navigation, and visual treatment while sharing the same component library and build output.

Server-derived data should continue to enter those layout groups through `load` functions and props by default. If extracted components inside a layout group start sharing the same small client-side snapshot, the parent layout or page may hydrate a `lib/state` mirror for that client tree.

The `setup/` route lives outside both layout groups and is only accessible when no admin account exists.

---

## 12. API Surface Mapping

This section provides a consolidated reference of which upstream API endpoints otpravkarr actually consumes and for what purpose. This serves as both a dependency inventory and a compatibility contract.

### Plex (`@ctrl/plex`)

| otpravkarr Operation | `@ctrl/plex` Method / Endpoint | Notes |
|---|---|---|
| Admin token validation | `new PlexServer(url, token).connect()` | Throws `Unauthorized` on bad token |
| Admin OAuth login | `MyPlexAccount.getWebLogin(forwardUrl)` → `MyPlexAccount.webLoginCheck(webLogin)` | Both static methods. Returns connected `MyPlexAccount` |
| Server discovery | `account.resources()` → `resource.connect()` | Returns `MyPlexResource[]`, each connectable to a `PlexServer` |
| Server identity | `PlexServer.machineIdentifier`, `.friendlyName` | Used to detect server changes between syncs |
| Friend enumeration | `MyPlexAccount.query({ url: 'https://plex.tv/api/v2/friends', method: 'get' })` | Not a dedicated method — uses the generic `query()` escape hatch. Response shape must be validated manually |
| User OAuth login | Same `getWebLogin` / `webLoginCheck` flow | Returns `MyPlexAccount` with `id`, `uuid`, `username`, `email`, `thumb` |
| Single-user verification | Filter friend list by `id` | In-memory operation on cached friend data |

### Dispatcharr REST API

| otpravkarr Operation | Dispatcharr Endpoint | Method | Key Fields |
|---|---|---|---|
| Connectivity check | `/api/accounts/users/?page=1&page_size=1` | GET | Expects paginated response envelope |
| Create user | `/api/accounts/users/` | POST | `username` (required), `password` (required), `email`, `is_staff`, `is_active`, `groups` (array of IDs) |
| Get user | `/api/accounts/users/{id}/` | GET | Returns full user object |
| Update user | `/api/accounts/users/{id}/` | PUT | Used for group changes, password rotation, deactivation (`is_active: false`) |
| Delete user | `/api/accounts/users/{id}/` | DELETE | Avoided in favor of deactivation |
| List groups | `/api/accounts/groups/` | GET | Returns `id`, `name`, `permissions` |
| List channel profiles | `/api/channels/profiles/` | GET | Returns profile list with IDs |
| List channels | `/api/channels/channels/` | GET | Paginated. Used for M3U generation |
| Get channel streams | `/api/channels/channels/{id}/streams/` | GET | Used to resolve stream URLs per channel for M3U building |
| Auth (API key) | `Authorization: ApiKey <key>` header | — | Sent on every request. Long-lived. One active key per Dispatcharr user |

---

## 13. Resolved Questions & Remaining Risks

### Resolved: Plex Friend Enumeration

The `@ctrl/plex` library's `PlexServer.systemAccounts()` method returns `SystemAccount` objects — server-local records of every account that has ever interacted with the server. This is unsuitable for determining active sharing relationships. The correct approach is to use `MyPlexAccount.query()` to call the plex.tv friends/sharing API directly. The `query()` method supports arbitrary HTTP requests with the account's auth token, so hitting plex.tv endpoints is straightforward. The response shape is not typed by the library, so otpravkarr must define its own `PlexFriend` type and validate responses defensively.

### Resolved: Dispatcharr User Model

Dispatcharr has no built-in "streamer" or "standard" user type. Its user model is flat: `username`, `password`, `email`, `is_staff`, `is_active`, `groups`. The differentiation between fully-automatic streaming users and self-managed users is entirely a otpravkarr-level abstraction, tracked in the local `user_mappings` table and enforced by otpravkarr's provisioning logic.

### Resolved: Dispatcharr Authentication

Dispatcharr supports two auth methods: JWT token pairs (via POST `/api/accounts/token/`) and API keys (via `Authorization: ApiKey <key>` header). otpravkarr uses API key auth exclusively. JWT is unnecessary — the API key is long-lived, does not require refresh, and is simpler to manage for a machine-to-machine integration. The key is stored encrypted in otpravkarr's config table and sent in the Authorization header on every request.

### Resolved: Dispatcharr Group Assignment

Groups are assigned at user creation time via the `groups` array field on the POST `/api/accounts/users/` payload. This is an array of group IDs, not names. otpravkarr fetches the group list during setup (GET `/api/accounts/groups/`), lets the admin pick a default, and stores the group ID. Changing a user's group after creation requires a PUT to `/api/accounts/users/{id}/` with the updated `groups` array.

### Remaining Risk: Dispatcharr XC Surface

The Dispatcharr API docs do not describe the XC-protocol player-facing endpoints. The `get.php` URL format, the `player_api.php` path, and the live-stream URL structure all need to be confirmed against a running instance. The `/api/connect/` and `/api/hdhr/` modules are listed but undocumented. otpravkarr mitigates this by treating the XC URL format as a configurable template and by probing known XC paths during setup. If Dispatcharr uses non-standard paths, the admin can override.

### Remaining Risk: Dispatcharr API Stability

Dispatcharr is under active development. API key support was recently added. The typed client in `lib/dispatcharr` should be defensively coded: validating response shapes on every call, failing with clear error messages if endpoints return unexpected structures, and logging response anomalies to the audit log. The Swagger UI at the running instance should be considered the source of truth over any static documentation.

### Remaining Risk: Plex Friends API Shape

The plex.tv friends endpoint used via `MyPlexAccount.query()` is not formally documented by `@ctrl/plex`. The response shape must be reverse-engineered from a live call and may change without notice. otpravkarr should treat this as a brittle integration point: validate every response, log unexpected shapes, and surface failures clearly in the admin dashboard.

### Naming

"otpravkarr" is a working title. Final name TBD. The *arr-style naming signals the self-hosting ecosystem correctly but the app's bridging function might warrant something more descriptive.
