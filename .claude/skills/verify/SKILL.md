---
name: verify
description: Run otpravkarr's targeted and full validation commands.
---

# Verify a change

1. Run the narrowest relevant test first:
   - Unit/component file:
     `bunx vitest run src/path/to/file.test.ts`
   - One unit/component case:
     `bunx vitest run src/path/to/file.test.ts -t "case name"`
   - One configured E2E project/file:
     `bunx playwright test e2e/admin-users.spec.ts --project=app`
   - One E2E case:
     `bunx playwright test e2e/admin-users.spec.ts --project=app --grep "case name"`
2. Run all unit/component tests: `bun run test`.
3. Run the static gates:
   `bun run check && bunx svelte-check --threshold warning && bunx tsc --noEmit`.
4. For production/runtime, migration, adapter, or E2E changes, run `bun run build`.
5. For browser-flow changes, run `bun run test:e2e`. Playwright creates and seeds a fresh temporary
   SQLite database, builds the app, starts it in production mode on port 4173, and runs projects
   sequentially through their configured dependencies.

`bun run check` is Biome only. `tsconfig.json` excludes `src/**/__tests__/**`, so passing `tsc`
does not replace Vitest.
