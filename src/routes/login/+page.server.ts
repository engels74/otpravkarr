import type { Actions, RequestEvent } from "@sveltejs/kit";
import { fail, redirect } from "@sveltejs/kit";
import { verifyAdminPassword } from "$lib/crypto/passwords";
import { getAdminByUsername } from "$lib/db/repositories/admin";
import { appendAuditLog } from "$lib/db/repositories/audit";
import { createSession } from "$lib/db/repositories/sessions";
import { AuditAction } from "$lib/db/types";
import { ADMIN_COOKIE_OPTIONS, ADMIN_SESSION_TTL, SESSION_COOKIE_NAME } from "$lib/server/auth";
import { loginLimiter } from "$lib/server/ratelimit";

const DASHBOARD_PATH = "/dashboard";

export const load = async ({ locals }: RequestEvent) => {
  if (locals.session?.type === "admin" && locals.admin) {
    throw redirect(303, DASHBOARD_PATH);
  }

  return {};
};

export const actions: Actions = {
  default: async ({ request, cookies, getClientAddress }) => {
    const clientAddress = getClientAddress();
    const limit = loginLimiter.check(clientAddress);
    if (!limit.allowed) {
      return fail(429, { error: "rate_limited" });
    }

    const formData = await request.formData();
    const username = String(formData.get("username") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    if (!username || !password) {
      return fail(400, { error: "missing_credentials" });
    }

    const admin = getAdminByUsername(username);
    if (!admin) {
      return fail(401, { error: "invalid_credentials" });
    }

    const passwordValid = await verifyAdminPassword(password, admin.password_hash);
    if (!passwordValid) {
      return fail(401, { error: "invalid_credentials" });
    }

    const sessionId = createSession(admin.username, "admin", ADMIN_SESSION_TTL);
    cookies.set(SESSION_COOKIE_NAME, sessionId, ADMIN_COOKIE_OPTIONS);

    appendAuditLog({
      actor: admin.username,
      action: AuditAction.ADMIN_LOGIN,
      ipAddress: clientAddress,
    });

    throw redirect(303, DASHBOARD_PATH);
  },
};
