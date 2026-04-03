import { reconcileSync } from "$lib/bridge/lifecycle";
import { appendAuditLog } from "$lib/db/repositories/audit";
import { getConfig } from "$lib/db/repositories/config";
import { AuditAction } from "$lib/db/types";
import { DispatcharrClient } from "$lib/dispatcharr/client";
import type { Job } from "$lib/scheduler/runner";

const JOB_NAME = "plex-dispatcharr-sync";
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

function log(event: string, extra?: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      job: JOB_NAME,
      ...extra,
    }),
  );
}

export function createSyncJob(defaultIntervalMs = DEFAULT_INTERVAL_MS): Job {
  return {
    name: JOB_NAME,
    interval: defaultIntervalMs,
    fn: async () => {
      const [dispatcharrUrl, apiKey, plexAdminToken] = await Promise.all([
        getConfig("dispatcharr_url"),
        getConfig("dispatcharr_api_key"),
        getConfig("plex_admin_token"),
      ]);

      if (!dispatcharrUrl || !apiKey || !plexAdminToken) {
        log("sync.skipped", {
          reason: "missing_config",
          missing: [
            !dispatcharrUrl && "dispatcharr_url",
            !apiKey && "dispatcharr_api_key",
            !plexAdminToken && "plex_admin_token",
          ].filter(Boolean),
        });
        return;
      }

      try {
        const client = new DispatcharrClient(dispatcharrUrl, apiKey);
        const report = await reconcileSync(client, plexAdminToken);
        log("sync.completed", { report });
        try {
          appendAuditLog({
            action: AuditAction.SYNC_COMPLETED,
            detail: { report },
          });
        } catch (auditError) {
          log("audit.error", {
            error: auditError instanceof Error ? auditError.message : String(auditError),
          });
        }
      } catch (error) {
        log("sync.error", {
          error: error instanceof Error ? error.message : String(error),
        });
        try {
          appendAuditLog({
            action: AuditAction.SYNC_FAILED,
            detail: { error: error instanceof Error ? error.message : String(error) },
          });
        } catch (auditError) {
          log("audit.error", {
            error: auditError instanceof Error ? auditError.message : String(auditError),
          });
        }
      }
    },
  };
}
