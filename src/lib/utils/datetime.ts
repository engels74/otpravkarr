const SQLITE_DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

/**
 * Normalize SQLite datetime('now') values (`YYYY-MM-DD HH:MM:SS`) into a
 * browser-safe ISO timestamp (`YYYY-MM-DDTHH:MM:SSZ`).
 */
export function normalizeSqliteDatetime(value: string): string {
  const trimmed = value.trim();
  if (!SQLITE_DATETIME_RE.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed.replace(" ", "T")}Z`;
}
