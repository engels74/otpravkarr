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

  const initial = queryAuditLog(filters);
  let entries = initial.entries;
  const total = initial.total;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  // ISSUE-013: clamp an out-of-range page to the last page so the labels never
  // read "Showing 51–50 of 50" / "Page 6 of 5". Re-query only on the rare
  // clamped path; page is already floored to 1 above.
  let clampedPage = page;
  if (page > totalPages) {
    clampedPage = totalPages;
    entries = queryAuditLog({ ...filters, offset: (clampedPage - 1) * limit }).entries;
  }

  return {
    entries,
    total,
    filters: { action, actor, after, before, page: clampedPage, limit },
    totalPages,
    auditActions: Object.values(AuditAction),
  };
};
