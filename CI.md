# CI and Renovate

Every pull request and default-branch push runs Biome, TypeScript and warning-free
Svelte checks, the full Vitest suite, production/browser checks, and prek hygiene.
`ci / required` requires exactly these jobs plus the dispatch guard; missing,
skipped, cancelled or failed jobs block merging. No path filters remove required CI.

Use Bun 1.4.2 and `bun install --frozen-lockfile`, then `bun run check`,
`bun run check:types`, `bun run test`, and `bun run test:e2e`. The type script aligns
CI and prek and prepares generated SvelteKit types first. Frozen installation now
propagates preparation failures. The application remains Bun/SQLite; Node is used
only by test/tool CLIs. CI installs the lockfile's Playwright Chromium on Ubuntu 24.04.

The E2E command builds once, verifies the exact migration directory shipped in
`build/server/migrations`, and boots two successive real production servers on
separate disposable SQLite databases. The ordinary admin/portal tests and fresh
setup test both run; neither mode silently skips the other. Tests have one worker
because they share state and authentication rate limits. No retries hide failures.
The fresh setup mode seeds only the claimed wizard and tests creation of the first
admin. The full live Plex/Dispatcharr connection wizard remains outside this suite.
Failure reports are retained for seven days.

Shared workflows and actions come from immutable full version tags. Permissions
are read-only, jobs have timeouts, superseded runs cancel, and dependency caches
include the lockfile/runtime/runner architecture. Prek's formatting/types hooks are
covered by their dedicated read-only CI checks, while hygiene and secret detection
remain separate. Source and lockfile mutation fails validation.

Renovate uses `edbfi/automation:default`, including grouped non-major updates,
pre-commit hook discovery and the official Biome version manager. The v1.1.0
default and automerge presets make all update types eligible, including majors
and shared-policy updates, without dashboard approval. All six current-head jobs
in `.github/merge-policy.json` must pass; TypeScript and warning-free Svelte checks
remain required. The checked merge preserves genuine sign-offs and dispatches
full CI for the exact merged commit.
Biome migrations compute without write privileges, then a separate publisher writes
allowlisted source/config changes and dispatches full CI for the exact repaired SHA.
Large repairs beyond the shared limits need manual handling.

Other changes retain manual review of the exact head/base, full diff, authors/DCO,
all CI jobs and relevant artifacts before merging through ghmerge.
No branch protections or repository rulesets are configured. The suite uses local fake credentials and
loopback service addresses; real Plex/Dispatcharr behavior, image packaging in the
separate repository, and deployment hosting remain explicit integration gaps.
