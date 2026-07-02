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

// ISSUE-007: a single transient Dispatcharr probe failure (e.g. one timeout)
// must not hard-flip the public dashboard/`/api/health` to "disconnected" while
// an authenticated sync still works. Require two consecutive unreachable probes
// before flipping; a lone failure keeps the last-known-good reachable/authValid.
// The per-probe HEALTH_CHECK_FAILED audit log is still emitted every time, so
// the signal is never suppressed for operators — only the coarse public flip is
// debounced.
const DISPATCHARR_FAILURE_THRESHOLD = 2;
let dispatcharrConsecutiveFailures = 0;

/** A reachable probe (success, or 401 with reachable=true) resets hysteresis. */
function publishDispatcharrReachable(authValid: boolean, now: string): void {
  dispatcharrConsecutiveFailures = 0;
  currentHealth.dispatcharr = { reachable: true, authValid, lastChecked: now };
}

/** An unreachable probe only flips the public state after the threshold. */
function publishDispatcharrUnreachable(now: string): void {
  dispatcharrConsecutiveFailures += 1;
  if (dispatcharrConsecutiveFailures >= DISPATCHARR_FAILURE_THRESHOLD) {
    currentHealth.dispatcharr = { reachable: false, authValid: false, lastChecked: now };
  } else {
    // Single transient failure: keep the last-known-good reachable/authValid,
    // only advance the timestamp.
    currentHealth.dispatcharr = { ...currentHealth.dispatcharr, lastChecked: now };
  }
}

export function getHealthStatus(): HealthStatus {
  return structuredClone(currentHealth);
}

/**
 * Seeds health state to all-healthy after setup completes.
 * The setup wizard already validated Plex, Dispatcharr, and SQLite,
 * so we can skip re-checking and just mark everything as connected.
 */
export function seedInitialHealth(): void {
  const now = new Date().toISOString();
  currentHealth.plex = { status: "healthy", lastChecked: now };
  currentHealth.dispatcharr = { reachable: true, authValid: true, lastChecked: now };
  currentHealth.database = { status: "healthy", lastChecked: now };
  dispatcharrConsecutiveFailures = 0;
}

/** @internal — for testing only */
export function resetHealthState(): void {
  currentHealth.plex = { status: "unreachable", lastChecked: null };
  currentHealth.dispatcharr = { reachable: false, authValid: false, lastChecked: null };
  currentHealth.database = { status: "unhealthy", lastChecked: null };
  dispatcharrConsecutiveFailures = 0;
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
      let plexUrl: string | null = null;
      let plexToken: string | null = null;
      let plexMachineId: string | null = null;
      try {
        plexUrl = await getConfig("plex_server_url");
        plexToken = await getConfig("plex_admin_token");
        plexMachineId = await getConfig("plex_machine_id");
      } catch (error) {
        log("config.error", {
          check: "plex",
          error: error instanceof Error ? error.message : String(error),
        });
      }

      if (plexUrl && plexToken && plexMachineId) {
        try {
          const status = await checkServerHealth(plexUrl, plexToken, plexMachineId);
          currentHealth.plex = { status, lastChecked: now };

          if (status !== "healthy") {
            log("plex.unhealthy", { status });
            try {
              appendAuditLog({
                action: AuditAction.HEALTH_CHECK_FAILED,
                detail: { check: "plex", status },
              });
            } catch (auditError) {
              log("audit.error", {
                error: auditError instanceof Error ? auditError.message : String(auditError),
              });
            }
          }
        } catch (error) {
          currentHealth.plex = { status: "unreachable", lastChecked: now };
          log("plex.error", { error: error instanceof Error ? error.message : String(error) });
          try {
            appendAuditLog({
              action: AuditAction.HEALTH_CHECK_FAILED,
              detail: {
                check: "plex",
                error: error instanceof Error ? error.message : String(error),
              },
            });
          } catch (auditError) {
            log("audit.error", {
              error: auditError instanceof Error ? auditError.message : String(auditError),
            });
          }
        }
      } else {
        currentHealth.plex = { status: "unreachable", lastChecked: null };
      }

      // --- Dispatcharr check ---
      let dispatcharrUrl: string | null = null;
      let dispatcharrApiKey: string | null = null;
      try {
        dispatcharrUrl = await getConfig("dispatcharr_url");
        dispatcharrApiKey = await getConfig("dispatcharr_api_key");
      } catch (error) {
        log("config.error", {
          check: "dispatcharr",
          error: error instanceof Error ? error.message : String(error),
        });
      }

      if (dispatcharrUrl && dispatcharrApiKey) {
        try {
          // Robust client (15s + retry) on purpose: a background probe has no
          // idle-socket deadline, and a fast-fail profile would make a single
          // network blip *more* likely to read as a failure. The hysteresis
          // below debounces the public flip instead (ISSUE-007).
          const client = new DispatcharrClient(dispatcharrUrl, dispatcharrApiKey);
          const endpoints = createHealthEndpoints(client);
          const result = await endpoints.checkHealth();

          if (result.ok) {
            if (result.data.reachable) {
              // Reachable (auth may still be invalid = a definitive 401):
              // publish immediately and reset the transient-failure counter.
              publishDispatcharrReachable(result.data.authValid, now);
            } else {
              // Unreachable: debounce the public flip via hysteresis.
              publishDispatcharrUnreachable(now);
            }

            if (!result.data.reachable || !result.data.authValid) {
              log("dispatcharr.unhealthy", {
                reachable: result.data.reachable,
                authValid: result.data.authValid,
              });
              try {
                appendAuditLog({
                  action: AuditAction.HEALTH_CHECK_FAILED,
                  detail: {
                    check: "dispatcharr",
                    reachable: result.data.reachable,
                    authValid: result.data.authValid,
                  },
                });
              } catch (auditError) {
                log("audit.error", {
                  error: auditError instanceof Error ? auditError.message : String(auditError),
                });
              }
            }
          } else {
            // Defensive: checkHealth() currently always returns ok:true, but this
            // handles a potential future API change where ok:false is returned.
            publishDispatcharrUnreachable(now);
            const errorDetail = result.message || result.error || "Unknown error";
            log("dispatcharr.error", { error: errorDetail });
            try {
              appendAuditLog({
                action: AuditAction.HEALTH_CHECK_FAILED,
                detail: { check: "dispatcharr", error: errorDetail },
              });
            } catch (auditError) {
              log("audit.error", {
                error: auditError instanceof Error ? auditError.message : String(auditError),
              });
            }
          }
        } catch (error) {
          publishDispatcharrUnreachable(now);
          log("dispatcharr.error", {
            error: error instanceof Error ? error.message : String(error),
          });
          try {
            appendAuditLog({
              action: AuditAction.HEALTH_CHECK_FAILED,
              detail: {
                check: "dispatcharr",
                error: error instanceof Error ? error.message : String(error),
              },
            });
          } catch (auditError) {
            log("audit.error", {
              error: auditError instanceof Error ? auditError.message : String(auditError),
            });
          }
        }
      } else {
        dispatcharrConsecutiveFailures = 0;
        currentHealth.dispatcharr = { reachable: false, authValid: false, lastChecked: null };
      }

      // --- SQLite check ---
      try {
        const db = getDb();
        db.exec("CREATE TABLE IF NOT EXISTS _health_check (id INTEGER PRIMARY KEY, ts TEXT)");
        db.prepare("INSERT OR REPLACE INTO _health_check (id, ts) VALUES (1, ?)").run(now);
        const row = db.prepare("SELECT ts FROM _health_check WHERE id = 1").get() as
          | { ts: string }
          | undefined;
        if (row?.ts === now) {
          currentHealth.database = { status: "healthy", lastChecked: now };
        } else {
          currentHealth.database = { status: "unhealthy", lastChecked: now };
          log("database.readback_mismatch", { expected: now, got: row?.ts });
          try {
            appendAuditLog({
              action: AuditAction.HEALTH_CHECK_FAILED,
              detail: {
                check: "database",
                error: "readback_mismatch",
                expected: now,
                got: row?.ts,
              },
            });
          } catch (auditError) {
            log("audit.error", {
              error: auditError instanceof Error ? auditError.message : String(auditError),
            });
          }
        }
      } catch (error) {
        currentHealth.database = { status: "unhealthy", lastChecked: now };
        log("database.error", { error: error instanceof Error ? error.message : String(error) });
        try {
          appendAuditLog({
            action: AuditAction.HEALTH_CHECK_FAILED,
            detail: {
              check: "database",
              error: error instanceof Error ? error.message : String(error),
            },
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
