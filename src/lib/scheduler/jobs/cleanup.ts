import { deleteExpiredSessions } from "$lib/db/repositories/sessions";
import type { Job } from "$lib/scheduler/runner";

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export function createCleanupJob(defaultIntervalMs: number = DEFAULT_INTERVAL_MS): Job {
  return {
    name: "session-cleanup",
    interval: defaultIntervalMs,
    fn: async () => {
      try {
        const deletedCount = deleteExpiredSessions();
        console.log(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            event: "job.session-cleanup",
            job: "session-cleanup",
            deletedCount,
          }),
        );
      } catch (err) {
        console.log(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            event: "job.session-cleanup.error",
            job: "session-cleanup",
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    },
  };
}
