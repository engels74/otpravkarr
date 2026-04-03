import { getDb } from "$lib/db/connection";
import { appendAuditLog } from "$lib/db/repositories/audit";
import { getConfig } from "$lib/db/repositories/config";
import { AuditAction } from "$lib/db/types";
import { DispatcharrClient } from "$lib/dispatcharr/client";
import { createHealthEndpoints } from "$lib/dispatcharr/endpoints/health";
import { checkServerHealth } from "$lib/plex/client";
import type { PlexConnectionStatus } from "$lib/plex/types";
import type { Job } from "$lib/scheduler/runner";

export interface HealthStatus {
  plex: { status: PlexConnectionStatus; lastChecked: string | null };
  dispatcharr: { reachable: boolean; authValid: boolean; lastChecked: string | null };
  database: { status: "healthy" | "unhealthy"; lastChecked: string | null };
}

const currentHealth: HealthStatus = {
  plex: { status: "unreachable", lastChecked: null },
  dispatcharr: { reachable: false, authValid: false, lastChecked: null },
  database: { status: "unhealthy", lastChecked: null },
};

export function getHealthStatus(): HealthStatus {
  return currentHealth;
}

function log(event: string, extra?: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      job: "health-check",
      ...extra,
    }),
  );
}

export function createHealthJob(defaultIntervalMs = 5 * 60 * 1000): Job {
  return {
    name: "health-check",
    interval: defaultIntervalMs,
    fn: async () => {
      const now = new Date().toISOString();

      // --- Plex check ---
      const plexUrl = await getConfig("plex_server_url");
      const plexToken = await getConfig("plex_admin_token");
      const plexMachineId = await getConfig("plex_machine_id");

      if (plexUrl && plexToken && plexMachineId) {
        try {
          const status = await checkServerHealth(plexUrl, plexToken, plexMachineId);
          currentHealth.plex = { status, lastChecked: now };

          if (status !== "healthy") {
            log("plex.unhealthy", { status });
            appendAuditLog({
              action: AuditAction.HEALTH_CHECK_FAILED,
              detail: { check: "plex", status },
            });
          }
        } catch (error) {
          currentHealth.plex = { status: "unreachable", lastChecked: now };
          log("plex.error", { error: error instanceof Error ? error.message : String(error) });
          appendAuditLog({
            action: AuditAction.HEALTH_CHECK_FAILED,
            detail: {
              check: "plex",
              error: error instanceof Error ? error.message : String(error),
            },
          });
        }
      }

      // --- Dispatcharr check ---
      const dispatcharrUrl = await getConfig("dispatcharr_url");
      const dispatcharrApiKey = await getConfig("dispatcharr_api_key");

      if (dispatcharrUrl && dispatcharrApiKey) {
        try {
          const client = new DispatcharrClient(dispatcharrUrl, dispatcharrApiKey);
          const endpoints = createHealthEndpoints(client);
          const result = await endpoints.checkHealth();

          if (result.ok) {
            currentHealth.dispatcharr = {
              reachable: result.data.reachable,
              authValid: result.data.authValid,
              lastChecked: now,
            };

            if (!result.data.reachable || !result.data.authValid) {
              log("dispatcharr.unhealthy", {
                reachable: result.data.reachable,
                authValid: result.data.authValid,
              });
              appendAuditLog({
                action: AuditAction.HEALTH_CHECK_FAILED,
                detail: {
                  check: "dispatcharr",
                  reachable: result.data.reachable,
                  authValid: result.data.authValid,
                },
              });
            }
          } else {
            currentHealth.dispatcharr = { reachable: false, authValid: false, lastChecked: now };
            log("dispatcharr.error", { error: result.message });
            appendAuditLog({
              action: AuditAction.HEALTH_CHECK_FAILED,
              detail: { check: "dispatcharr", error: result.message },
            });
          }
        } catch (error) {
          currentHealth.dispatcharr = { reachable: false, authValid: false, lastChecked: now };
          log("dispatcharr.error", {
            error: error instanceof Error ? error.message : String(error),
          });
          appendAuditLog({
            action: AuditAction.HEALTH_CHECK_FAILED,
            detail: {
              check: "dispatcharr",
              error: error instanceof Error ? error.message : String(error),
            },
          });
        }
      }

      // --- SQLite check ---
      try {
        getDb().prepare("SELECT 1").get();
        currentHealth.database = { status: "healthy", lastChecked: now };
      } catch (error) {
        currentHealth.database = { status: "unhealthy", lastChecked: now };
        log("database.error", { error: error instanceof Error ? error.message : String(error) });
        appendAuditLog({
          action: AuditAction.HEALTH_CHECK_FAILED,
          detail: {
            check: "database",
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    },
  };
}
