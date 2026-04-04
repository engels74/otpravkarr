import { redirect } from "@sveltejs/kit";
import { appendAuditLog } from "$lib/db/repositories/audit";
import { deleteSession } from "$lib/db/repositories/sessions";
import { AuditAction } from "$lib/db/types";
import { SESSION_COOKIE_NAME } from "$lib/server/auth";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ cookies, locals, getClientAddress }) => {
  const sessionType = locals.session?.type;
  const sessionId = cookies.get(SESSION_COOKIE_NAME);

  if (sessionId) {
    deleteSession(sessionId);
  }

  cookies.delete(SESSION_COOKIE_NAME, { path: "/" });

  if (locals.admin) {
    appendAuditLog({
      actor: locals.admin.username,
      action: AuditAction.ADMIN_LOGOUT,
      ipAddress: getClientAddress(),
    });
  }

  throw redirect(303, sessionType === "user" ? "/" : "/login");
};
