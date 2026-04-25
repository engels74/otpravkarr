import { reconcileSync } from "$lib/bridge/lifecycle";
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
      return reconcileSync(client, plexAdminToken);
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

    return Response.json({ ok: true, report: exclusive.result }, { status: 200 });
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
