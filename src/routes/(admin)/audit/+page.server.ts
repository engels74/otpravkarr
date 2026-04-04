import { queryAuditLog } from "$lib/db/repositories/audit";
import { AuditAction } from "$lib/db/types";
import { requireAdmin } from "$lib/server/auth";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async (event) => {
  await requireAdmin(event);
  const { url } = event;
  const action = url.searchParams.get("action") || null;
  const actor = url.searchParams.get("actor") || null;
  const after = url.searchParams.get("after") || null;
  const before = url.searchParams.get("before") || null;
  const afterUtc = url.searchParams.get("afterUtc") || null;
  const beforeUtc = url.searchParams.get("beforeUtc") || null;
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
  const effectiveAfter = afterUtc ?? after;
  const effectiveBefore = beforeUtc ?? before;

  if (action) filters.action = action;
  if (actor) filters.actor = actor;
  if (effectiveAfter) filters.after = effectiveAfter;
  if (effectiveBefore) filters.before = effectiveBefore;

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
