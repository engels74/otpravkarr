import { runFullReconcile } from "$lib/bridge/reconcile";
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

export async function createSyncJob(defaultIntervalMs = DEFAULT_INTERVAL_MS): Promise<Job> {
  // Try to read configured interval from config table; fall back to default
  let intervalMs = defaultIntervalMs;
  try {
    const configuredMinutes = await getConfig("sync_interval_minutes");
    if (configuredMinutes) {
      const parsed = Number(configuredMinutes);
      if (Number.isFinite(parsed) && parsed > 0) {
        intervalMs = parsed * 60 * 1000;
      }
    }
  } catch (error) {
    log("config.warn", {
      key: "sync_interval_minutes",
      error: error instanceof Error ? error.message : String(error),
      fallback: defaultIntervalMs,
    });
  }

  return {
    name: JOB_NAME,
    interval: intervalMs,
    fn: async () => {
      let dispatcharrUrl: string | null = null;
      let apiKey: string | null = null;
      let plexAdminToken: string | null = null;
      try {
        [dispatcharrUrl, apiKey, plexAdminToken] = await Promise.all([
          getConfig("dispatcharr_url"),
          getConfig("dispatcharr_api_key"),
          getConfig("plex_admin_token"),
        ]);
      } catch (error) {
        log("config.error", {
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }

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
        appendAuditLog({
          action: AuditAction.SYNC_STARTED,
          detail: { trigger: "scheduler" },
        });
      } catch (auditError) {
        log("audit.error", {
          error: auditError instanceof Error ? auditError.message : String(auditError),
        });
      }

      try {
        const client = new DispatcharrClient(dispatcharrUrl, apiKey);
        // Full reconcile sequence (reconcileSync → quarantine → subscriptions →
        // ECM), shared with the manual "Run Sync Now" route so the two paths
        // can never diverge. reconcileSync owns the single sync.completed audit
        // write, so the scheduler no longer writes its own (de-dupes
        // ISSUE-006/007); this only emits the structured operational log.
        const { report, quarantine, subscriptions, ecmScope } = await runFullReconcile(
          client,
          plexAdminToken,
        );
        log("sync.completed", { report, quarantine, subscriptions, ecmScope });
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
