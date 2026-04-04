import { fail } from "@sveltejs/kit";
import { appendAuditLog } from "$lib/db/repositories/audit";
import { getConfig, invalidateConfigCache, setConfig } from "$lib/db/repositories/config";
import { AuditAction } from "$lib/db/types";
import { DispatcharrClient } from "$lib/dispatcharr/client";
import { createHealthEndpoints } from "$lib/dispatcharr/endpoints/health";
import { validateServerToken } from "$lib/plex/client";
import { PlexAuthError, PlexConnectionError } from "$lib/plex/types";
import { createSyncJob } from "$lib/scheduler/jobs/sync";
import { scheduler } from "$lib/scheduler/runner";
import { requireAdmin } from "$lib/server/auth";
import { parseAndNormalizeOrigins } from "$lib/server/origins";
import type { Actions, PageServerLoad } from "./$types";

const MAX_SYNC_INTERVAL_MINUTES = 1440;

export const load: PageServerLoad = async (event) => {
  await requireAdmin(event);
  const [
    plexServerUrl,
    plexAdminToken,
    plexMachineId,
    dispatcharrUrl,
    dispatcharrApiKey,
    syncIntervalMinutes,
    allowedOrigins,
    auditRetentionDays,
  ] = await Promise.all([
    getConfig("plex_server_url"),
    getConfig("plex_admin_token"),
    getConfig("plex_machine_id"),
    getConfig("dispatcharr_url"),
    getConfig("dispatcharr_api_key"),
    getConfig("sync_interval_minutes"),
    getConfig("allowed_origins"),
    getConfig("audit_retention_days"),
  ]);

  // Parse allowed origins from JSON array to newline-separated string for textarea
  let originsText = "";
  if (allowedOrigins) {
    try {
      const parsed: unknown = JSON.parse(allowedOrigins);
      if (Array.isArray(parsed)) {
        originsText = parsed.join("\n");
      }
    } catch {
      originsText = allowedOrigins;
    }
  }

  return {
    plex: {
      serverUrl: plexServerUrl ?? "",
      hasToken: Boolean(plexAdminToken),
      machineId: plexMachineId ?? "",
    },
    dispatcharr: {
      url: dispatcharrUrl ?? "",
      hasApiKey: Boolean(dispatcharrApiKey),
    },
    sync: {
      intervalMinutes: syncIntervalMinutes ?? "15",
    },
    security: {
      allowedOrigins: originsText,
    },
    audit: {
      retentionDays: auditRetentionDays ?? "90",
    },
  };
};

export const actions: Actions = {
  updatePlexConnection: async (event) => {
    await requireAdmin(event);
    const { request, locals, getClientAddress } = event;
    const fd = await request.formData();
    const serverUrl = String(fd.get("plex_server_url") ?? "").trim();
    const newToken = String(fd.get("plex_admin_token") ?? "").trim();
    const [currentServerUrl, currentToken, currentMachineId] = await Promise.all([
      getConfig("plex_server_url"),
      getConfig("plex_admin_token"),
      getConfig("plex_machine_id"),
    ]);
    const effectiveToken = newToken || (currentToken ?? "").trim();

    const actor = locals.admin?.username ?? "unknown";
    const changedFields: string[] = [];

    if (!serverUrl || !effectiveToken) {
      return fail(400, { error: "Plex token and server URL are required" });
    }

    try {
      const serverInfo = await validateServerToken(serverUrl, effectiveToken);

      if (serverUrl !== (currentServerUrl ?? "")) {
        await setConfig("plex_server_url", serverUrl);
        changedFields.push("plex_server_url");
      }

      if (newToken && newToken !== (currentToken ?? "")) {
        await setConfig("plex_admin_token", newToken, true);
        changedFields.push("plex_admin_token");
      }

      if (serverInfo.machineIdentifier !== (currentMachineId ?? "")) {
        await setConfig("plex_machine_id", serverInfo.machineIdentifier);
        changedFields.push("plex_machine_id");
      }
    } catch (err: unknown) {
      if (err instanceof PlexAuthError || err instanceof PlexConnectionError) {
        return fail(400, { error: err.message });
      }
      throw err;
    }

    invalidateConfigCache();

    appendAuditLog({
      actor,
      action: AuditAction.CONFIG_CHANGED,
      detail: { section: "plex", fields: changedFields },
      ipAddress: getClientAddress(),
    });

    return { success: true };
  },

  updateDispatcharrConnection: async (event) => {
    await requireAdmin(event);
    const { request, locals, getClientAddress } = event;
    const fd = await request.formData();
    const url = String(fd.get("dispatcharr_url") ?? "").trim();
    const newKey = String(fd.get("dispatcharr_api_key") ?? "").trim();
    const [currentUrl, currentKey] = await Promise.all([
      getConfig("dispatcharr_url"),
      getConfig("dispatcharr_api_key"),
    ]);
    const effectiveKey = newKey || (currentKey ?? "").trim();

    const actor = locals.admin?.username ?? "unknown";
    const changedFields: string[] = [];

    if (!url || !effectiveKey) {
      return fail(400, { error: "Dispatcharr URL and API key are required" });
    }

    const client = new DispatcharrClient(url, effectiveKey);
    const healthResult = await createHealthEndpoints(client).checkHealth();
    if (!healthResult.ok) {
      return fail(400, { error: "Could not connect to Dispatcharr" });
    }

    if (!healthResult.data.reachable) {
      return fail(400, { error: "Dispatcharr server is unreachable" });
    }

    if (!healthResult.data.authValid) {
      return fail(400, { error: "Dispatcharr API key is invalid" });
    }

    if (url !== (currentUrl ?? "")) {
      await setConfig("dispatcharr_url", url);
      changedFields.push("dispatcharr_url");
    }

    if (newKey && newKey !== (currentKey ?? "")) {
      await setConfig("dispatcharr_api_key", newKey, true);
      changedFields.push("dispatcharr_api_key");
    }

    invalidateConfigCache();

    appendAuditLog({
      actor,
      action: AuditAction.CONFIG_CHANGED,
      detail: { section: "dispatcharr", fields: changedFields },
      ipAddress: getClientAddress(),
    });

    return { success: true };
  },

  updateSyncSettings: async (event) => {
    await requireAdmin(event);
    const { request, locals, getClientAddress } = event;
    const fd = await request.formData();
    const raw = String(fd.get("sync_interval_minutes") ?? "").trim();
    const interval = Number.parseInt(raw, 10);

    if (!Number.isFinite(interval) || interval < 1 || interval > MAX_SYNC_INTERVAL_MINUTES) {
      return fail(400, {
        error: `Sync interval must be a number between 1 and ${MAX_SYNC_INTERVAL_MINUTES}`,
      });
    }

    const actor = locals.admin?.username ?? "unknown";

    await setConfig("sync_interval_minutes", String(interval));
    invalidateConfigCache();
    scheduler.register(await createSyncJob());

    appendAuditLog({
      actor,
      action: AuditAction.CONFIG_CHANGED,
      detail: { section: "sync", field: "sync_interval_minutes", value: interval },
      ipAddress: getClientAddress(),
    });

    return { success: true };
  },

  updateDefaultProvisioning: async (event) => {
    await requireAdmin(event);
    return fail(400, {
      error:
        "Default provisioning overrides are currently unavailable because runtime provisioning does not consume these settings.",
    });
  },

  updateSecurity: async (event) => {
    await requireAdmin(event);
    const { request, locals, getClientAddress } = event;
    const fd = await request.formData();
    const raw = String(fd.get("allowed_origins") ?? "");
    const { origins, invalidOrigin } = parseAndNormalizeOrigins(raw, /\r?\n/);
    if (invalidOrigin) {
      return fail(400, { error: `Invalid origin: ${invalidOrigin}` });
    }

    const actor = locals.admin?.username ?? "unknown";

    await setConfig("allowed_origins", JSON.stringify(origins));
    invalidateConfigCache();

    appendAuditLog({
      actor,
      action: AuditAction.CONFIG_CHANGED,
      detail: { section: "security", field: "allowed_origins", count: origins.length },
      ipAddress: getClientAddress(),
    });

    return { success: true };
  },

  updateAuditRetention: async (event) => {
    await requireAdmin(event);
    const { request, locals, getClientAddress } = event;
    const fd = await request.formData();
    const raw = String(fd.get("audit_retention_days") ?? "").trim();
    const days = Number.parseInt(raw, 10);

    if (!Number.isFinite(days) || days < 1) {
      return fail(400, { error: "Retention days must be a positive integer" });
    }

    const actor = locals.admin?.username ?? "unknown";

    await setConfig("audit_retention_days", String(days));
    invalidateConfigCache();

    appendAuditLog({
      actor,
      action: AuditAction.CONFIG_CHANGED,
      detail: { section: "audit", field: "audit_retention_days", value: days },
      ipAddress: getClientAddress(),
    });

    return { success: true };
  },
};
