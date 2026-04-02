import { error } from "@sveltejs/kit";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function validateOrigin(request: Request, allowedOrigins: string[]): void {
  if (!MUTATING_METHODS.has(request.method)) return;

  if (allowedOrigins.length === 0) return;

  const origin = request.headers.get("Origin");

  if (!origin) {
    throw error(403, "CSRF validation failed: missing Origin header");
  }

  const normalizedOrigin = origin.replace(/\/+$/, "");
  const normalizedAllowed = allowedOrigins.map((o) => o.replace(/\/+$/, ""));

  if (!normalizedAllowed.includes(normalizedOrigin)) {
    throw error(403, "CSRF validation failed: origin not allowed");
  }
}
