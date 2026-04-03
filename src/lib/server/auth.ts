import type { RequestEvent } from "@sveltejs/kit";
import { error, redirect } from "@sveltejs/kit";
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

export const ADMIN_COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  secure: true,
  sameSite: "strict" as const,
  maxAge: ADMIN_SESSION_TTL,
};

export const USER_COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  maxAge: USER_SESSION_TTL,
};

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

  return user;
}

export async function requireSetupIncomplete(): Promise<void> {
  if (await isSetupComplete()) {
    throw error(404);
  }
}

export async function isSetupComplete(): Promise<boolean> {
  return (await getConfig(SETUP_COMPLETED_CONFIG_KEY)) === SETUP_COMPLETED_VALUE;
}
