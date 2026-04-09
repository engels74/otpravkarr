/**
 * Stub for $app/forms used as a Vitest resolve alias.
 *
 * SvelteKit's $app/* modules are virtual — they only exist inside
 * the SvelteKit build pipeline. When Vitest processes Svelte
 * components that import $app/forms, Vite's resolver needs a real
 * file to point at. Tests then override this stub via vi.mock().
 *
 * Using a project-local stub avoids depending on SvelteKit's
 * internal file layout (node_modules/@sveltejs/kit/src/runtime/…),
 * which can change between releases.
 */

export function enhance(_node: HTMLFormElement, _submit?: unknown) {
  return { destroy() {} };
}

export async function applyAction(_result: unknown) {}

export async function deserialize(_result: string) {
  return {};
}
