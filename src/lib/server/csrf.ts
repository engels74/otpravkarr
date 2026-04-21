import { error } from "@sveltejs/kit";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function canonicalize(value: string): string | null {
  try {
    const { origin } = new URL(value);
    return origin === "null" ? null : origin.toLowerCase();
  } catch {
    return null;
  }
}

export function validateOrigin(request: Request, allowedOrigins: string[]): void {
  if (!MUTATING_METHODS.has(request.method)) return;

  if (allowedOrigins.length === 0) return;

  const rawOrigin = request.headers.get("Origin");

  if (!rawOrigin) {
    throw error(403, "CSRF validation failed: missing Origin header");
  }

  const normalizedOrigin = canonicalize(rawOrigin);
  if (!normalizedOrigin) {
    throw error(403, "CSRF validation failed: invalid Origin header");
  }

  const normalizedAllowed = allowedOrigins
    .map(canonicalize)
    .filter((value): value is string => value !== null);

  if (!normalizedAllowed.includes(normalizedOrigin)) {
    throw error(403, "CSRF validation failed: origin not allowed");
  }
}
