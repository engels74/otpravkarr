import type { Handle } from "@sveltejs/kit";
import { redirect } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";
import { initializeDatabase } from "$lib/db/connection";
import { validateEnv } from "$lib/server/env";
import { isSetupComplete, SESSION_COOKIE_NAME } from "$lib/server/auth";
import { createRequestLogger } from "$lib/server/logging";
import { validateOrigin } from "$lib/server/csrf";
import { getSession } from "$lib/db/repositories/sessions";
import { adminExists, getAdminByUsername } from "$lib/db/repositories/admin";
import { getUserMappingById } from "$lib/db/repositories/users";
import { getConfig } from "$lib/db/repositories/config";
import { scheduler } from "$lib/scheduler/runner";
import { createSyncJob } from "$lib/scheduler/jobs/sync";
import { createHealthJob } from "$lib/scheduler/jobs/health";
import { createCleanupJob } from "$lib/scheduler/jobs/cleanup";
import { createAuditRotationJob } from "$lib/scheduler/jobs/audit-rotation";
import { createBootstrapToken } from "$lib/crypto/bootstrap";
import { env } from "$env/dynamic/private";

// Validate required environment variables on server startup
validateEnv();

// Initialize database and run pending migrations
await initializeDatabase();

// Register scheduler jobs
const syncJob = await createSyncJob();
scheduler.register(syncJob);
scheduler.register(createHealthJob());
scheduler.register(createCleanupJob());
scheduler.register(createAuditRotationJob());
scheduler.start();

// Print bootstrap token banner if no admin exists
if (!adminExists()) {
	const token = createBootstrapToken();
	const origin = env.ORIGIN || `http://${env.HOST || "localhost"}:${env.PORT || "3000"}`;
	const setupUrl = `${origin}/setup?token=${token}`;
	console.log("========================================");
	console.log("OTPRAVKARR FIRST-RUN SETUP");
	console.log("========================================");
	console.log(`Bootstrap token: ${token}`);
	console.log(`Setup URL: ${setupUrl}`);
	console.log("This token expires in 15 minutes.");
	console.log("========================================");
}

// ---------------------------------------------------------------------------
// Handle middleware
// ---------------------------------------------------------------------------

const setupGate: Handle = async ({ event, resolve }) => {
	if (
		!isSetupComplete() &&
		!event.url.pathname.startsWith("/setup") &&
		event.url.pathname !== "/api/health" &&
		!event.url.pathname.startsWith("/_app/") &&
		!event.url.pathname.startsWith("/favicon")
	) {
		throw redirect(303, "/setup");
	}
	return resolve(event);
};

const sessionResolver: Handle = async ({ event, resolve }) => {
	event.locals.requestId = crypto.randomUUID();

	const sessionId = event.cookies.get(SESSION_COOKIE_NAME);
	if (!sessionId) {
		event.locals.session = null;
		event.locals.admin = null;
		event.locals.user = null;
		return resolve(event);
	}

	const session = getSession(sessionId);
	if (!session) {
		event.locals.session = null;
		event.locals.admin = null;
		event.locals.user = null;
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
		const userId = Number.parseInt(session.user_ref, 10);
		event.locals.user = Number.isNaN(userId) ? null : getUserMappingById(userId);
		event.locals.admin = null;
	} else {
		event.locals.admin = null;
		event.locals.user = null;
	}

	return resolve(event);
};

const csrfValidator: Handle = async ({ event, resolve }) => {
	const method = event.request.method;
	if (
		isSetupComplete() &&
		(method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE")
	) {
		const originsConfig = await getConfig("allowed_origins");
		if (originsConfig) {
			const parsedOrigins = JSON.parse(originsConfig) as string[];
			validateOrigin(event.request, parsedOrigins);
		}
	}
	return resolve(event);
};

const requestLogger = createRequestLogger();

export const handle = sequence(setupGate, sessionResolver, csrfValidator, requestLogger);
