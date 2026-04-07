import { getDb } from "../connection";
import type { AuditEntry } from "../types";

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isDateOnlyFilter(value: string): boolean {
  return DATE_ONLY_RE.test(value);
}

/**
 * Append an entry to the audit log.
 * Serializes `detail` as JSON if provided.
 */
export function appendAuditLog(entry: {
  actor?: string;
  action: string;
  detail?: Record<string, unknown>;
  ipAddress?: string;
}): void {
  const db = getDb();
  const detailJson = entry.detail != null ? JSON.stringify(entry.detail) : null;

  db.prepare("INSERT INTO audit_log (actor, action, detail, ip_address) VALUES (?, ?, ?, ?)").run(
    entry.actor ?? null,
    entry.action,
    detailJson,
    entry.ipAddress ?? null,
  );
}

/**
 * Query audit log entries with optional filters and pagination.
 * Returns matching entries and the total count (without limit/offset).
 */
export function queryAuditLog(filters: {
  action?: string;
  actor?: string;
  after?: string;
  before?: string;
  limit?: number;
  offset?: number;
}): { entries: AuditEntry[]; total: number } {
  const db = getDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.action != null) {
    conditions.push("action = ?");
    params.push(filters.action);
  }

  if (filters.actor != null) {
    if (filters.actor.toLowerCase() === "system") {
      conditions.push("(actor IS NULL OR actor = ?)");
      params.push("system");
    } else {
      conditions.push("actor = ?");
      params.push(filters.actor);
    }
  }

  if (filters.after != null) {
    conditions.push("timestamp >= datetime(?)");
    params.push(filters.after);
  }

  if (filters.before != null) {
    if (isDateOnlyFilter(filters.before)) {
      // Date-only "before" values come from the UI date picker and should include that full day.
      conditions.push("timestamp < datetime(?, '+1 day')");
    } else {
      conditions.push("timestamp <= datetime(?)");
    }
    params.push(filters.before);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Get total count
  const countRow = db
    .prepare(`SELECT COUNT(*) as count FROM audit_log ${whereClause}`)
    .get(...params) as { count: number };
  const total = countRow.count;

  // Get paginated entries
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const entries = db
    .prepare(
      `SELECT id, timestamp, actor, action, detail, ip_address FROM audit_log ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as AuditEntry[];

  return { entries, total };
}
