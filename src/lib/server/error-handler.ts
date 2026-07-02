import type { HandleServerError } from "@sveltejs/kit";

/**
 * ISSUE-012: SvelteKit's default server error handler logs an unhelpful
 * `undefined` for uncaught SSR throws, so production 500s are undiagnosable.
 * This replacement logs a single structured JSON line (matching the request
 * logger / health job style) carrying the real error class, message, and
 * stack — or `String(error)` for non-Error throws — while returning a generic
 * body to the client so no internal detail leaks (Phase-12 posture).
 */
export const handleError: HandleServerError = ({ error, event, status, message }) => {
  const isError = error instanceof Error;

  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event: "unhandled_error",
      requestId: event.locals?.requestId ?? null,
      method: event.request.method,
      path: event.url.pathname,
      status,
      message,
      error: isError
        ? { name: error.name, message: error.message, stack: error.stack }
        : String(error),
    }),
  );

  return { message: "Internal Error" };
};
