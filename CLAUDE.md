# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this
repository.

## Commands

- Install: `bun install`
- Develop: `OTPRAVKARR_SECRET="$(openssl rand -base64 32)" bun --bun run dev`
- Production build/start: `bun run build`, then `OTPRAVKARR_SECRET="<secret>" bun run start`
- Biome lint/format check: `bun run check`
- Full static gate: `bun run check && bunx svelte-check --threshold warning && bunx tsc --noEmit`
- Unit/component tests: `bun run test`
- E2E tests: `bun run test:e2e`

`bun run check` runs only Biome; it is not the repository's type or Svelte check. The full static
gate mirrors the local checks in `prek.toml`.

## Repository invariants

- Container packaging belongs exclusively to
  [`engels74/otpravkarr-docker`](https://github.com/engels74/otpravkarr-docker). Do not add
  Dockerfiles, `.dockerignore`, image-build workflows, or temporary container build contexts to
  this application repository, and do not modify the packaging repository without explicit
  instruction. For image validation, trigger the packaging repository's build workflow and wait
  for it to finish before pulling `ghcr.io/engels74/otpravkarr-docker:nightly`, or build that
  repository locally; do not pin the deployment to a development digest.
- Add schema changes as the next `src/lib/db/migrations/NNN_name.sql`; do not edit an applied
  migration. Keep the migration-copy step in `package.json`'s `build` command: production resolves
  SQL from `build/server/migrations`.
- Do not represent a zero-group Dispatcharr subscription with `channel_profiles: []`; that exposes
  the full catalog. Route subscription writes through
  `src/lib/bridge/subscriptions.ts:applyGroupSubscription`, which assigns the shared empty profile.
- Treat `src/lib/bridge/reconcile.ts:runFullReconcile` as the shared manual/scheduled sync sequence;
  do not create a second sequence in a route or job.
- Unit tests alias `$app/forms`, `$app/navigation`, and `$app/state` to
  `src/lib/test-stubs/*` in `vitest.config.ts`; tests using those aliases do not exercise the real
  SvelteKit modules.
- `e2e/setup-wizard-fresh.spec.ts` is not collected by any project in `playwright.config.ts` and
  skips unless `E2E_SEED_SETUP_PRE_ADMIN=1`; do not assume the default E2E command covers it.
- Import `uno.css` from `src/hooks.client.ts`, not a root layout. Keep CSP-compatible styling:
  `svelte.config.ts` disallows inline style attributes.

## Reference rules

- `.augment/rules/bun-svelte-pro.md` — Svelte 5 runes, SvelteKit 2, Bun, UnoCSS, and
  shadcn-svelte conventions. Read before writing components, client state, or styling.
- `.claude/references/domain-invariants.md` — authentication, provisioning, subscription, and sync
  boundaries. Read before changing server routes, hooks, bridge code, or scheduler jobs.

## Skills

- `.claude/skills/verify/SKILL.md` — targeted and full validation commands. Use before declaring a
  code change complete.
- `.claude/skills/rotate-master-key/SKILL.md` — transactional encrypted-field key rotation. Use
  when changing `OTPRAVKARR_SECRET` for an existing database.
