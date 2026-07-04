import type { Handle } from "@sveltejs/kit";
import { redirect } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";
import { building } from "$app/environment";
import { env } from "$env/dynamic/private";
import { hydrateQuarantineGroupsFromConfig } from "$lib/bridge/quarantine-sync";
import { createBootstrapToken } from "$lib/crypto/bootstrap";
import { initializeDatabase } from "$lib/db/connection";
import { getAdminByUsername } from "$lib/db/repositories/admin";
import { getConfig } from "$lib/db/repositories/config";
import { deleteSession, getSession, refreshSession } from "$lib/db/repositories/sessions";
import { getUserMappingById } from "$lib/db/repositories/users";
import { createAuditRotationJob } from "$lib/scheduler/jobs/audit-rotation";
import { createCleanupJob } from "$lib/scheduler/jobs/cleanup";
import { createHealthJob } from "$lib/scheduler/jobs/health";
import { createSyncJob } from "$lib/scheduler/jobs/sync";
import { scheduler } from "$lib/scheduler/runner";
import {
  ADMIN_COOKIE_OPTIONS,
  ADMIN_SESSION_TTL,
  isSetupComplete,
  SESSION_COOKIE_NAME,
  USER_COOKIE_OPTIONS,
  USER_SESSION_TTL,
} from "$lib/server/auth";
import { validateFetchMetadata, validateOrigin } from "$lib/server/csrf";
import { validateEnv } from "$lib/server/env";
import { handleError as serverErrorHandler } from "$lib/server/error-handler";
import { createRequestLogger } from "$lib/server/logging";
import { markServerStarted } from "$lib/server/uptime";

let runtimeInitialization: Promise<void> | null = null;

const SECURITY_HEADERS = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
} as const;

function applySecurityHeaders(response: Response): Response {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

function toForbiddenResponse(error: unknown): Response | null {
  if (typeof error !== "object" || error === null || !("status" in error) || error.status !== 403) {
    return null;
  }

  const body = "body" in error && error.body !== undefined ? error.body : { message: "Forbidden" };

  if (typeof body === "string") {
    return new Response(body, { status: 403 });
  }

  return Response.json(body, { status: 403 });
}

async function registerSchedulerJobs(): Promise<void> {
  // Restore the last resolved quarantine-group names so renamed IPTV Checker
  // junk groups stay hidden during the window before the first sync reconciles
  // them against the live plugin. No network I/O; best-effort.
  await hydrateQuarantineGroupsFromConfig();

  const syncJob = await createSyncJob();
  const healthJob = createHealthJob();

  await healthJob.fn();

  scheduler.register(syncJob);
  scheduler.register(healthJob);
  scheduler.register(createCleanupJob());
  scheduler.register(createAuditRotationJob());
  scheduler.start();
}

async function printBootstrapBanner(): Promise<void> {
  // Setup can be incomplete even when an admin account already exists
  // (e.g. interrupted multi-step setup), so gate on setup completion instead.
  if (await isSetupComplete()) {
    return;
  }
  const token = createBootstrapToken();
  let host = env.HOST || "localhost";
  if (host === "0.0.0.0" || host === "::" || host === "0:0:0:0:0:0:0:0") {
    host = "localhost";
  }
  const origin = env.ORIGIN || `http://${host}:${env.PORT || "3000"}`;
  const setupUrl = `${origin}/setup`;
  console.log("========================================");
  console.log("OTPRAVKARR FIRST-RUN SETUP");
  console.log("========================================");
  console.log(`Bootstrap token: ${token}`);
  console.log(`Setup URL: ${setupUrl}`);
  console.log("This token expires in 15 minutes.");
  console.log("Enter the token manually against this same running instance only.");
  console.log("Restarting the app or switching to another worker invalidates this token.");
  console.log("========================================");
}

async function ensureRuntimeInitialized(): Promise<void> {
  if (!runtimeInitialization) {
    runtimeInitialization = (async () => {
      validateEnv();
      await initializeDatabase();
      if (!building) {
        await registerSchedulerJobs();
        await printBootstrapBanner();
        markServerStarted();
      }
    })();
  }

  try {
    await runtimeInitialization;
  } catch (error) {
    runtimeInitialization = null;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Handle middleware
// ---------------------------------------------------------------------------

const localsInit: Handle = async ({ event, resolve }) => {
  event.locals.requestId = crypto.randomUUID();
  event.locals.session = null;
  event.locals.admin = null;
  event.locals.user = null;
  event.locals.revokedUser = null;
  return resolve(event);
};

const runtimeInit: Handle = async ({ event, resolve }) => {
  if (building) {
    return resolve(event);
  }

  await ensureRuntimeInitialized();
  return resolve(event);
};

const setupGate: Handle = async ({ event, resolve }) => {
  if (building) {
    return resolve(event);
  }

  const setupComplete = await isSetupComplete();
  if (
    !setupComplete &&
    !event.url.pathname.startsWith("/setup") &&
    event.url.pathname !== "/api/health" &&
    !event.url.pathname.startsWith("/_app/") &&
    event.url.pathname !== "/favicon.ico" &&
    event.url.pathname !== "/favicon.svg" &&
    event.url.pathname !== "/otpravkarr-icon.svg" &&
    event.url.pathname !== "/robots.txt"
  ) {
    throw redirect(303, "/setup");
  }
  return resolve(event);
};

const sessionResolver: Handle = async ({ event, resolve }) => {
  if (building) {
    return resolve(event);
  }

  const sessionId = event.cookies.get(SESSION_COOKIE_NAME);
  if (!sessionId) {
    return resolve(event);
  }

  const session = getSession(sessionId);
  if (!session) {
    return resolve(event);
  }

  event.locals.session = {
    id: session.id,
    type: session.session_type,
    userRef: session.user_ref,
  };

  if (session.session_type === "admin") {
    const admin = getAdminByUsername(session.user_ref);
    event.locals.admin = admin ? { id: admin.id, username: admin.username } : null;
    event.locals.user = null;
    event.locals.revokedUser = null;
    refreshSession(session.id, ADMIN_SESSION_TTL);
    event.cookies.set(SESSION_COOKIE_NAME, sessionId, ADMIN_COOKIE_OPTIONS);
  } else if (session.session_type === "user") {
    const userId = /^\d+$/.test(session.user_ref)
      ? Number.parseInt(session.user_ref, 10)
      : Number.NaN;
    const mapping = Number.isNaN(userId) ? null : getUserMappingById(userId);
    if (mapping?.is_active === 1) {
      event.locals.user = mapping;
      event.locals.revokedUser = null;
      event.locals.admin = null;
      refreshSession(session.id, USER_SESSION_TTL);
      event.cookies.set(SESSION_COOKIE_NAME, sessionId, USER_COOKIE_OPTIONS);
    } else if (mapping) {
      // Inactive mapping: keep it out of locals.user so credential-serving
      // sinks (requireUser) never see a revoked user, but expose it via
      // locals.revokedUser so the portal can still render the revoked view.
      event.locals.user = null;
      event.locals.revokedUser = mapping;
      event.locals.admin = null;
      refreshSession(session.id, USER_SESSION_TTL);
      event.cookies.set(SESSION_COOKIE_NAME, sessionId, USER_COOKIE_OPTIONS);
    } else {
      // Missing mapping: the underlying user no longer exists, so there is no
      // valid identity to maintain. Invalidate the orphaned ("ghost") session
      // instead of sliding its expiry, which would otherwise keep it alive
      // indefinitely and risk identity confusion if the mapping ID is reused.
      deleteSession(session.id);
      event.cookies.delete(SESSION_COOKIE_NAME, { path: "/" });
      event.locals.session = null;
      event.locals.user = null;
      event.locals.revokedUser = null;
      event.locals.admin = null;
    }
  } else {
    event.locals.session = null;
    event.locals.admin = null;
    event.locals.user = null;
    event.locals.revokedUser = null;
  }

  return resolve(event);
};

const csrfValidator: Handle = async ({ event, resolve }) => {
  if (building) {
    return resolve(event);
  }

  const method = event.request.method;
  if (
    (await isSetupComplete()) &&
    (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE")
  ) {
    // Internal admin/portal APIs without a session should report 401 (auth required)
    // rather than 403 (origin rejected) — the absence of credentials is a more useful
    // signal than the origin allowlist outcome to a developer. This no-session 401 is
    // distinct from the authz layer (requireAdminApi): once a session exists, that layer
    // returns 403 for an authenticated non-admin and 401 for missing/stale credentials.
    const isInternalApi = event.url.pathname.startsWith("/api/internal/");
    const hasSession = event.locals.admin !== null || event.locals.user !== null;
    if (isInternalApi && !hasSession) {
      return applySecurityHeaders(Response.json({ error: "unauthorized" }, { status: 401 }));
    }

    if (isInternalApi && hasSession) {
      try {
        validateFetchMetadata(event.request);
      } catch (error) {
        const forbiddenResponse = toForbiddenResponse(error);
        if (forbiddenResponse) {
          return applySecurityHeaders(forbiddenResponse);
        }
        throw error;
      }
    }

    let originsConfig: string | null = null;
    try {
      originsConfig = await getConfig("allowed_origins");
    } catch {
      // DB or decryption error — fall through to fail-closed behavior
    }
    let parsedOrigins: string[] = [];
    if (originsConfig) {
      try {
        const parsed: unknown = JSON.parse(originsConfig);
        if (
          Array.isArray(parsed) &&
          parsed.every((item): item is string => typeof item === "string")
        ) {
          parsedOrigins = parsed;
        }
      } catch {
        // Malformed JSON in config — treat as empty so we fall through to fail-closed
      }
    }
    try {
      if (parsedOrigins.length === 0) {
        // Fail closed: prefer ORIGIN env var (set by deployer) over request URL
        // to avoid mismatches behind reverse proxies where the internal URL
        // (e.g. http://127.0.0.1:3000) differs from the public origin.
        const fallbackOrigin = env.ORIGIN || new URL(event.request.url).origin;
        validateOrigin(event.request, [fallbackOrigin]);
      } else {
        validateOrigin(event.request, parsedOrigins);
      }
    } catch (error) {
      const forbiddenResponse = toForbiddenResponse(error);
      if (forbiddenResponse) {
        return applySecurityHeaders(forbiddenResponse);
      }
      throw error;
    }
  }
  return resolve(event);
};

const securityHeaders: Handle = async ({ event, resolve }) => {
  return applySecurityHeaders(await resolve(event));
};

const requestLogger = createRequestLogger();

// ISSUE-012: replace SvelteKit's default handler (which logs `undefined`) with a
// structured logger that surfaces the real error class/message/stack while
// keeping the client-facing body generic.
export const handleError = serverErrorHandler;

export const handle = sequence(
  requestLogger,
  localsInit,
  runtimeInit,
  setupGate,
  sessionResolver,
  csrfValidator,
  securityHeaders,
);
