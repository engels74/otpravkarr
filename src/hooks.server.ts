import type { Handle } from "@sveltejs/kit";
import { redirect } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";
import { building } from "$app/environment";
import { env } from "$env/dynamic/private";
import { createBootstrapToken } from "$lib/crypto/bootstrap";
import { initializeDatabase } from "$lib/db/connection";
import { getAdminByUsername } from "$lib/db/repositories/admin";
import { getConfig } from "$lib/db/repositories/config";
import { getSession } from "$lib/db/repositories/sessions";
import { getUserMappingById } from "$lib/db/repositories/users";
import { createAuditRotationJob } from "$lib/scheduler/jobs/audit-rotation";
import { createCleanupJob } from "$lib/scheduler/jobs/cleanup";
import { createHealthJob } from "$lib/scheduler/jobs/health";
import { createSyncJob } from "$lib/scheduler/jobs/sync";
import { scheduler } from "$lib/scheduler/runner";
import { isSetupComplete, SESSION_COOKIE_NAME } from "$lib/server/auth";
import { validateOrigin } from "$lib/server/csrf";
import { validateEnv } from "$lib/server/env";
import { createRequestLogger } from "$lib/server/logging";

let runtimeInitialization: Promise<void> | null = null;

async function registerSchedulerJobs(): Promise<void> {
  const syncJob = await createSyncJob();
  scheduler.register(syncJob);
  scheduler.register(createHealthJob());
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
  const setupUrl = `${origin}/setup?token=${token}`;
  console.log("========================================");
  console.log("OTPRAVKARR FIRST-RUN SETUP");
  console.log("========================================");
  console.log(`Bootstrap token: ${token}`);
  console.log(`Setup URL: ${setupUrl}`);
  console.log("This token expires in 15 minutes.");
  console.log("Use this setup link against this same running instance only.");
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
  } else if (session.session_type === "user") {
    const userId = /^\d+$/.test(session.user_ref)
      ? Number.parseInt(session.user_ref, 10)
      : Number.NaN;
    event.locals.user = Number.isNaN(userId) ? null : getUserMappingById(userId);
    event.locals.admin = null;
  } else {
    event.locals.session = null;
    event.locals.admin = null;
    event.locals.user = null;
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
    if (parsedOrigins.length === 0) {
      // Fail closed: prefer ORIGIN env var (set by deployer) over request URL
      // to avoid mismatches behind reverse proxies where the internal URL
      // (e.g. http://127.0.0.1:3000) differs from the public origin.
      const fallbackOrigin = env.ORIGIN || new URL(event.request.url).origin;
      validateOrigin(event.request, [fallbackOrigin]);
    } else {
      validateOrigin(event.request, parsedOrigins);
    }
  }
  return resolve(event);
};

const requestLogger = createRequestLogger();

export const handle = sequence(
  requestLogger,
  localsInit,
  runtimeInit,
  setupGate,
  sessionResolver,
  csrfValidator,
);
