import { reconcileEcmScope } from "$lib/bridge/ecm-scope";
import { reconcileSync } from "$lib/bridge/lifecycle";
import { reconcileQuarantineGroups } from "$lib/bridge/quarantine-sync";
import { reconcileSubscriptions } from "$lib/bridge/subscription-sync";
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
        const report = await reconcileSync(client, plexAdminToken);
        // Refresh the quarantine-group name policy from the live IPTV Checker
        // plugin BEFORE reconciling subscriptions, so renamed junk groups stay
        // hidden this cycle. Isolated: a failure here must not abort the sync.
        let quarantine: Awaited<ReturnType<typeof reconcileQuarantineGroups>> | { error: string };
        try {
          quarantine = await reconcileQuarantineGroups(client);
        } catch (qError) {
          quarantine = { error: qError instanceof Error ? qError.message : String(qError) };
        }
        // Converge channel-group subscriptions against live Dispatcharr state
        // (channels moved between groups, plugins created channels, etc.). Kept
        // separate so a subscription error never masks the friend-sync result.
        let subscriptions: Awaited<ReturnType<typeof reconcileSubscriptions>> | { error: string };
        try {
          subscriptions = await reconcileSubscriptions(client);
        } catch (subError) {
          subscriptions = {
            error: subError instanceof Error ? subError.message : String(subError),
          };
        }
        // Auto-write otpravkarr's group profiles into ECM's scope so event
        // automation reaches subscribers. Runs AFTER subscription reconciliation
        // so freshly created group profiles are included. Isolated like the rest.
        let ecmScope: Awaited<ReturnType<typeof reconcileEcmScope>> | { error: string };
        try {
          ecmScope = await reconcileEcmScope(client);
        } catch (ecmError) {
          ecmScope = { error: ecmError instanceof Error ? ecmError.message : String(ecmError) };
        }
        log("sync.completed", { report, quarantine, subscriptions, ecmScope });
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
