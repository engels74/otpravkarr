## Instructions

You are implementing a task from the otpravkarr project — a Plex↔Dispatcharr bridge application built with Bun, SvelteKit, and Svelte 5.

### Step 1: Read and Analyze the Task

Read `docs/otpravkarr-tasks.md` and locate the exact section matching the task identifier provided at the end of this prompt. Thoroughly analyze:

- **All subtasks** (checklist items `- [ ]`) under that section, including nested items
- **Dependencies** on prior tasks — check if prerequisite tasks are marked `- [x]` (completed). If any required dependency is incomplete, stop and report which dependencies are missing before proceeding
- **Rationales, gotchas, and notes** embedded in the task description (indented paragraphs, parenthetical notes, code blocks, etc.)
- **Cross-references** to other sections or phases that inform this task's implementation

### Step 2: Read Project Coding Standards

Read `.augment/rules/bun-svelte-pro.md` in full. Every line of code you produce **must** comply with these guidelines. Key requirements (non-exhaustive — the full document governs):

- **Bun ≥ 1.2 runtime** — prefer Bun-native APIs (`bun:sqlite`, `Bun.file`, `Bun.write`, `Bun.password`, `Bun.serve` WebSockets)
- **Svelte 5 runes only** — no legacy reactive declarations, no `$:`, no `export let`, no slots
  - `$state` for local reactive state (deep proxy by default; `$state.raw` for large immutable data)
  - `$derived` / `$derived.by` for computed values (never `$effect` for pure derivation)
  - `$effect` only for side effects with cleanup
  - `$props` with `interface Props` for typed component props
  - `$bindable` for explicit two-way binding
  - Snippets (`Snippet` from `svelte`) + `{@render ...}` — no slots
- **SvelteKit 2** — file-based routing, `+page.server.ts` for server loads/actions, `use:enhance` for progressive enhancement
  - `$env/static/private` and `$env/dynamic/private` for environment variables
  - `hooks.server.ts` for middleware-like handle hook with `event.locals`
- **TypeScript strict mode** — `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`, `verbatimModuleSyntax`
- **UnoCSS with presetWind4** — not Tailwind; import `uno.css` in `hooks.client.ts` (Safari-safe)
  - Wind4 theme keys (`radius` not `borderRadius`)
  - `content.pipeline.include` must cover `.svelte`, `.ts`, `.js` files
- **shadcn-svelte** — components in `$lib/components/ui/`, `cn()` via `clsx` + `tailwind-merge`
  - Bits UI v1 patterns: `child` snippet (not `asChild`), snippet props (not `let:`)
- **Shared state** — `.svelte.ts` modules exporting proxy objects; mutate properties, never reassign the exported binding
- **Biome** for formatting/linting — `indentStyle: "space"`, `indentWidth: 2`, `lineWidth: 100`
- **Vitest + Testing Library** for unit/component tests; **Playwright** for E2E
- **Superforms + Zod** for form handling with validation
- **`ofetch`** for HTTP client (Dispatcharr REST calls)
- **`@ctrl/plex`** for Plex API integration
- **`bun:sqlite`** with WAL mode and foreign keys enabled; prepared statements for all queries
- **File naming**: `kebab-case` for routes/util modules, `PascalCase` for components

### Step 3: Read Existing Codebase Context

Before writing any code:

1. Use `codebase-retrieval` to search for all types, modules, and functions referenced by the task
2. Read any files that will be modified or extended
3. Understand the existing module structure and naming conventions already established
4. Check for any existing tests that cover related functionality
5. Reference `docs/otpravkarr-prd.md` for architectural context and module boundaries
6. Reference `docs/ctrl-plex-api-docs.md` and `docs/dispatcharr-api-docs.md` for API details when implementing integration modules

### Step 4: Implement the Task

For each subtask (checklist item):

1. **Plan** the implementation approach before writing code
2. **Write** the code with full file paths, following the project's established directory structure
3. **Explain** any non-obvious architectural decisions inline (brief comments where logic isn't self-evident — no unnecessary docstrings)
4. **Test** — write corresponding unit tests using Vitest if the task involves testable logic
5. **Verify** — if possible, describe how to verify the implementation (build commands, expected behavior)

#### Code Quality Rules

- One primary type/module per file; use `kebab-case.ts` for modules, `PascalCase.svelte` for components
- Prefer `interface` over `type` for object shapes; use `type` for unions and aliases
- Use discriminated unions for result types (e.g., `DispatcharrResult<T>`)
- Validate external data at system boundaries with Zod schemas
- No `any` — use `unknown` and narrow; `any` only in test mocks where unavoidable
- No `@ts-ignore` or `@ts-expect-error` — fix the type issue
- No legacy Svelte patterns: no `$:`, no `export let`, no `<slot>`, no `on:event`, no `ObservableObject`-style stores
- No raw `console.log` in production paths — use structured logging (`src/lib/server/logging.ts`)
- Encrypt sensitive values at rest (Plex tokens, API keys, XC passwords) via `lib/crypto`
- Never expose secrets to the client — server-only imports via `$lib/server/` or `$env/*/private`
- Use prepared statements for all database queries — no string interpolation in SQL
- All components: `interface Props` + `$props<Props>()`, `cn()` for class composition, snippets for composition

### Step 5: Update the Implementation Plan

After completing each subtask, update `docs/otpravkarr-tasks.md` on disk:

- Change `- [ ]` to `- [x]` for each completed item (including nested items)
- Do **not** modify any other parts of the document
- Do **not** mark items complete unless the code is actually written and ready

### Step 6: Summary Report

After all work is done, provide a concise summary:

```
## Completed
- [x] Item 1 description
- [x] Item 2 description
...

## Files Created/Modified
- `path/to/file.ts` — description of what was added/changed
...

## Architectural Decisions
- Decision 1: rationale
...

## Deviations from Plan
- None (or: description + justification)

## Next Steps
- What tasks are now unblocked
- Any follow-up items discovered during implementation
```

---

## Task to Implement

<!-- Append the task identifier below. Examples:
     Implement: ### 0.1 — Create the SvelteKit project
     Implement: ### 1.2 — Field-level authenticated encryption
     Implement: ### 6.2 — User provisioning
-->
