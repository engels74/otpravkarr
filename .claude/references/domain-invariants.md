# Domain invariants

Read this before changing server routes, `src/hooks.server.ts`, `src/lib/bridge/`, or scheduler
jobs.

## Startup and authentication

- `src/hooks.server.ts` initializes the environment, migrations, scheduler, bootstrap banner, and
  request middleware. Preserve the exported `sequence` order: logging → locals → runtime setup →
  setup gate → session resolution → CSRF → security headers.
- Setup completeness is the `setup_completed` config value, not merely the presence of an admin.
  The bootstrap token is process-local, single-use, and expires after 15 minutes; restarting or
  switching workers invalidates it (`src/lib/crypto/bootstrap.ts`).
- Keep revoked user mappings in `locals.revokedUser`, never `locals.user`; credential-serving code
  uses `requireUser`. Delete sessions whose backing mapping no longer exists
  (`src/hooks.server.ts:sessionResolver`).
- Admin cookies are normally `SameSite=Strict`. Only the Plex owner OAuth redirect uses
  `ADMIN_OAUTH_COOKIE_OPTIONS` (`SameSite=Lax`); the next authenticated request restores Strict
  (`src/lib/server/auth.ts`).

## Dispatcharr ownership and subscription safety

- Otpravkarr owns only channel profiles named with `otpravkarr:`. Group ownership is the stable
  `otpravkarr:g{groupId}:` prefix, not the mutable full name or numeric profile ID
  (`src/lib/bridge/group-profiles.ts`).
- A newly created Dispatcharr profile initially enables every channel. Scope it through
  `reconcileGroupProfile`, which diffs and disables non-group channels; do not treat creation as an
  empty profile.
- Dispatcharr users at `user_level >= 10` bypass channel-profile filtering. Do not scope them;
  provision/update subscribers through `applyGroupSubscription`, which enforces level `1`.
- The Plex owner must be excluded from friend-sync disable/reaping with
  `excludePlexOwnerMappings`. Use `excludePlexOwnerNonSubscriberMappings` only for admin UI/drift
  surfaces where an explicitly subscribed owner remains visible (`src/lib/server/plex-owner.ts`).
- Quarantine groups are matched by names obtained from the IPTV Checker plugin plus permanent
  defaults. On absent, empty, or failed plugin reads, retain the existing set; narrowing it can
  expose quarantine channels (`src/lib/bridge/quarantine-sync.ts`).

## Reconciliation

- Both scheduled and manual synchronization use `src/lib/bridge/reconcile.ts:runFullReconcile`.
  Expected remote failures use `DispatcharrResult`; preserve that no-throw contract at bridge
  boundaries.
- A successful remote subscription patch followed by a failed local mirror write is an explicit
  inconsistent-state error. Audit logging after both writes is best-effort and must not turn a
  successful subscription into teardown (`src/lib/bridge/subscriptions.ts`).
