import { getDb } from "$lib/db/connection";
import { getConfig } from "$lib/db/repositories/config";
import type { Job } from "$lib/scheduler/runner";

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_RETENTION_DAYS = 90;

export function createAuditRotationJob(defaultIntervalMs: number = DEFAULT_INTERVAL_MS): Job {
  return {
    name: "audit-log-rotation",
    interval: defaultIntervalMs,
    fn: async () => {
      try {
        const configValue = await getConfig("audit_retention_days");
        let retentionDays = DEFAULT_RETENTION_DAYS;

        if (configValue !== null) {
          const parsed = Number(configValue);
          if (Number.isFinite(parsed) && parsed > 0) {
            retentionDays = parsed;
          }
        }

        const result = getDb()
          .prepare("DELETE FROM audit_log WHERE timestamp < datetime('now', ?)")
          .run(`-${retentionDays} days`);

        console.log(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            event: "job.audit-rotation",
            job: "audit-log-rotation",
            deletedCount: result.changes,
            retentionDays,
          }),
        );
      } catch (err) {
        console.log(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            event: "job.audit-rotation.error",
            job: "audit-log-rotation",
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    },
  };
}
