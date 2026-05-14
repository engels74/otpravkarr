import type { RequestEvent } from "@sveltejs/kit";
import { error, redirect } from "@sveltejs/kit";
import { dev } from "$app/environment";
import { getAdminByUsername } from "$lib/db/repositories/admin";
import { getConfig } from "$lib/db/repositories/config";
import { getSession } from "$lib/db/repositories/sessions";
import { getUserMappingById } from "$lib/db/repositories/users";
import type { AdminAccount, UserMapping } from "$lib/db/types";

export const SESSION_COOKIE_NAME = "otpravkarr_session";
export const ADMIN_SESSION_TTL = 3600;
export const USER_SESSION_TTL = 14400;
export const SETUP_COMPLETED_CONFIG_KEY = "setup_completed";
const SETUP_COMPLETED_VALUE = "true";

export const isSecure = !dev;

export const ADMIN_COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  secure: isSecure,
  sameSite: "strict" as const,
  maxAge: ADMIN_SESSION_TTL,
};

export const USER_COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  secure: isSecure,
  sameSite: "lax" as const,
  maxAge: USER_SESSION_TTL,
};

export async function getConfiguredAdminAccount(): Promise<AdminAccount | null> {
  const username = await getConfig("admin_username");
  if (!username) {
    return null;
  }

  return getAdminByUsername(username);
}

export async function requireAdmin(event: RequestEvent): Promise<AdminAccount> {
  const sessionId = event.cookies.get(SESSION_COOKIE_NAME);
  if (!sessionId) {
    throw redirect(303, "/login");
  }

  const session = getSession(sessionId);
  if (!session || session.session_type !== "admin") {
    event.cookies.delete(SESSION_COOKIE_NAME, { path: "/" });
    throw redirect(303, "/login");
  }

  const admin = getAdminByUsername(session.user_ref);
  if (!admin) {
    event.cookies.delete(SESSION_COOKIE_NAME, { path: "/" });
    throw redirect(303, "/login");
  }

  return admin;
}

export async function requireAdminApi(event: RequestEvent): Promise<AdminAccount> {
  const sessionId = event.cookies.get(SESSION_COOKIE_NAME);
  if (!sessionId) {
    throw error(401, { message: "Unauthorized" });
  }

  const session = getSession(sessionId);
  if (!session || session.session_type !== "admin") {
    throw error(401, { message: "Unauthorized" });
  }

  const admin = getAdminByUsername(session.user_ref);
  if (!admin) {
    throw error(401, { message: "Unauthorized" });
  }

  return admin;
}

export async function requireUser(event: RequestEvent): Promise<UserMapping> {
  const sessionId = event.cookies.get(SESSION_COOKIE_NAME);
  if (!sessionId) {
    throw redirect(303, "/");
  }

  const session = getSession(sessionId);
  if (!session || session.session_type !== "user") {
    event.cookies.delete(SESSION_COOKIE_NAME, { path: "/" });
    throw redirect(303, "/");
  }

  if (!/^\d+$/.test(session.user_ref)) {
    event.cookies.delete(SESSION_COOKIE_NAME, { path: "/" });
    throw redirect(303, "/");
  }

  const userId = Number.parseInt(session.user_ref, 10);
  if (Number.isNaN(userId)) {
    event.cookies.delete(SESSION_COOKIE_NAME, { path: "/" });
    throw redirect(303, "/");
  }

  const user = getUserMappingById(userId);
  if (!user) {
    event.cookies.delete(SESSION_COOKIE_NAME, { path: "/" });
    throw redirect(303, "/");
  }

  if (user.is_active !== 1) {
    // Do not destroy the session here — the portal root page displays a
    // revoked view for inactive users by reading locals.user directly, and
    // the user may still want to sign out cleanly. Sensitive routes that go
    // through requireUser() must not see an inactive user.
    throw redirect(303, "/");
  }

  return user;
}

export async function requireSetupIncomplete(): Promise<void> {
  if (await isSetupComplete()) {
    throw error(404);
  }
}

export async function isSetupComplete(): Promise<boolean> {
  const setupCompleted = await getConfig(SETUP_COMPLETED_CONFIG_KEY);
  return setupCompleted === SETUP_COMPLETED_VALUE;
}
