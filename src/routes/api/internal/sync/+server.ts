import { runFullReconcile } from "$lib/bridge/reconcile";
import { appendAuditLog } from "$lib/db/repositories/audit";
import { getConfig } from "$lib/db/repositories/config";
import { AuditAction } from "$lib/db/types";
import { DispatcharrClient } from "$lib/dispatcharr/client";
import { scheduler } from "$lib/scheduler/runner";
import { requireAdminApi } from "$lib/server/auth";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async (event) => {
  const admin = await requireAdminApi(event);
  const ipAddress = event.getClientAddress();

  const [dispatcharrUrl, apiKey, plexAdminToken] = await Promise.all([
    getConfig("dispatcharr_url"),
    getConfig("dispatcharr_api_key"),
    getConfig("plex_admin_token"),
  ]);

  const missing = [
    !dispatcharrUrl && "dispatcharr_url",
    !apiKey && "dispatcharr_api_key",
    !plexAdminToken && "plex_admin_token",
  ].filter(Boolean) as string[];

  if (missing.length > 0 || !dispatcharrUrl || !apiKey || !plexAdminToken) {
    return Response.json({ ok: false, error: "missing_config", missing }, { status: 503 });
  }

  try {
    const exclusive = await scheduler.runExclusive("plex-dispatcharr-sync", async () => {
      try {
        // actor is the admin who triggered this sync; scheduler-driven runs use actor: undefined (rendered as "system")
        appendAuditLog({
          actor: admin.username,
          action: AuditAction.SYNC_STARTED,
          detail: { trigger: "manual" },
          ipAddress,
        });
      } catch {
        // audit log failure should not block the sync
      }
      const client = new DispatcharrClient(dispatcharrUrl, apiKey);
      // Run the SAME full reconcile sequence as the scheduled job (friend sync →
      // quarantine → subscriptions → ECM scope) so "Run Sync Now" is a true full
      // sync (ISSUE-005). The helper must not re-acquire the lock — we already
      // hold "plex-dispatcharr-sync" here.
      return runFullReconcile(client, plexAdminToken);
    });

    if (!exclusive.ok) {
      if (exclusive.reason === "unknown_job") {
        return Response.json(
          { ok: false, error: "internal_error", message: "Sync job not registered" },
          { status: 500 },
        );
      }
      return Response.json({ ok: false, error: "sync_in_progress" }, { status: 409 });
    }

    // Preserve the existing { ok, report } API envelope; the full result's extra
    // reconcile details are surfaced via audit/logs, not this response.
    return Response.json({ ok: true, report: exclusive.result.report }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    try {
      appendAuditLog({
        actor: admin.username,
        action: AuditAction.SYNC_FAILED,
        detail: { error: message },
        ipAddress,
      });
    } catch {
      // audit log failure should not break the error response
    }

    return Response.json({ ok: false, error: "sync_failed", message }, { status: 500 });
  }
};
