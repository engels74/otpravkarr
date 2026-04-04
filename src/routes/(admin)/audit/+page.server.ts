import { queryAuditLog } from "$lib/db/repositories/audit";
import { AuditAction } from "$lib/db/types";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url }) => {
  const action = url.searchParams.get("action") || null;
  const actor = url.searchParams.get("actor") || null;
  const after = url.searchParams.get("after") || null;
  const before = url.searchParams.get("before") || null;
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit")) || 50));
  const offset = (page - 1) * limit;

  const filters: {
    action?: string;
    actor?: string;
    after?: string;
    before?: string;
    limit: number;
    offset: number;
  } = {
    limit,
    offset,
  };
  if (action) filters.action = action;
  if (actor) filters.actor = actor;
  if (after) filters.after = after;
  if (before) filters.before = before;

  const { entries, total } = queryAuditLog(filters);
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return {
    entries,
    total,
    filters: { action, actor, after, before, page, limit },
    totalPages,
    auditActions: Object.values(AuditAction),
  };
};
