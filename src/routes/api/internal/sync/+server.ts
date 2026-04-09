import { reconcileSync } from "$lib/bridge/lifecycle";
import { appendAuditLog } from "$lib/db/repositories/audit";
import { getConfig } from "$lib/db/repositories/config";
import { AuditAction } from "$lib/db/types";
import { DispatcharrClient } from "$lib/dispatcharr/client";
import { scheduler } from "$lib/scheduler/runner";
import { requireAdminApi } from "$lib/server/auth";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async (event) => {
  await requireAdminApi(event);

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

  const start = performance.now();

  try {
    const client = new DispatcharrClient(dispatcharrUrl, apiKey);
    const report = await reconcileSync(client, plexAdminToken);
    return Response.json({ ok: true, report }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    try {
      appendAuditLog({ action: AuditAction.SYNC_FAILED, detail: { error: message } });
    } catch {
      // audit log failure should not break the error response
    }

    return Response.json({ ok: false, error: "sync_failed", message }, { status: 500 });
  } finally {
    scheduler.notifyRun("plex-dispatcharr-sync", Math.round(performance.now() - start));
  }
};
