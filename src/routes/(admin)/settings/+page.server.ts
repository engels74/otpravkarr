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
import {
  AuditRetentionSchema,
  isHttpUrl,
  SyncIntervalSchema,
  sanitizeString,
} from "$lib/server/validation";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async (event) => {
  await requireAdmin(event);
  const [
    plexServerUrl,
    plexAdminToken,
    plexMachineId,
    dispatcharrUrl,
    dispatcharrApiKey,
    dispatcharrExternalUrl,
    syncIntervalMinutes,
    allowedOrigins,
    auditRetentionDays,
  ] = await Promise.all([
    getConfig("plex_server_url"),
    getConfig("plex_admin_token"),
    getConfig("plex_machine_id"),
    getConfig("dispatcharr_url"),
    getConfig("dispatcharr_api_key"),
    getConfig("dispatcharr_external_url"),
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
      externalUrl: dispatcharrExternalUrl ?? "",
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
    const serverUrl = sanitizeString(String(fd.get("plex_server_url") ?? ""));
    const newToken = sanitizeString(String(fd.get("plex_admin_token") ?? ""));
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
      if (err instanceof PlexAuthError) {
        return fail(400, { error: "Invalid or expired Plex token" });
      }
      if (err instanceof PlexConnectionError) {
        return fail(400, { error: "Could not connect to Plex server" });
      }
      return fail(500, { error: "Failed to save settings" });
    }

    invalidateConfigCache();

    appendAuditLog({
      actor,
      action: AuditAction.CONFIG_CHANGED,
      detail: { section: "plex", fields: changedFields },
      ipAddress: getClientAddress(),
    });

    return {
      success: true,
      message:
        changedFields.length > 0
          ? "Plex settings saved."
          : "Connection verified, no changes needed.",
    };
  },

  updateDispatcharrConnection: async (event) => {
    await requireAdmin(event);
    const { request, locals, getClientAddress } = event;
    const fd = await request.formData();
    const url = sanitizeString(String(fd.get("dispatcharr_url") ?? ""));
    const newKey = sanitizeString(String(fd.get("dispatcharr_api_key") ?? ""));
    const externalUrl = sanitizeString(String(fd.get("dispatcharr_external_url") ?? ""));
    const [currentUrl, currentKey, currentExternalUrl] = await Promise.all([
      getConfig("dispatcharr_url"),
      getConfig("dispatcharr_api_key"),
      getConfig("dispatcharr_external_url"),
    ]);
    const effectiveKey = newKey || (currentKey ?? "").trim();

    const actor = locals.admin?.username ?? "unknown";
    const changedFields: string[] = [];

    if (!url || !effectiveKey) {
      return fail(400, { error: "Dispatcharr URL and API key are required" });
    }

    if (!isHttpUrl(url)) {
      return fail(400, { error: "Dispatcharr URL must use http or https" });
    }

    if (externalUrl && !isHttpUrl(externalUrl)) {
      return fail(400, { error: "External URL must use http or https" });
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

    if (externalUrl !== (currentExternalUrl ?? "")) {
      await setConfig("dispatcharr_external_url", externalUrl);
      changedFields.push("dispatcharr_external_url");
    }

    invalidateConfigCache();

    appendAuditLog({
      actor,
      action: AuditAction.CONFIG_CHANGED,
      detail: { section: "dispatcharr", fields: changedFields },
      ipAddress: getClientAddress(),
    });

    return {
      success: true,
      message:
        changedFields.length > 0
          ? "Dispatcharr settings saved."
          : "Connection verified, no changes needed.",
    };
  },

  updateSyncSettings: async (event) => {
    await requireAdmin(event);
    const { request, locals, getClientAddress } = event;
    const fd = await request.formData();
    const syncResult = SyncIntervalSchema.safeParse({
      interval: sanitizeString(String(fd.get("sync_interval_minutes") ?? "")),
    });

    if (!syncResult.success) {
      return fail(400, {
        error:
          syncResult.error.issues[0]?.message ??
          "Sync interval must be a number between 1 and 1440",
      });
    }

    const interval = syncResult.data.interval;
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

    if (origins.length > 0) {
      // The lockout guard must match what CSRF validation actually checks:
      // the request Origin header (not url.origin, which may differ behind a reverse proxy).
      // Fall back to event.url.origin when Origin header is absent (e.g. same-origin or
      // non-browser clients) so the guard is never silently skipped.
      const requestOrigin = request.headers.get("Origin") ?? event.url.origin;
      const normalizedRequestOrigin = requestOrigin.replace(/\/+$/, "").toLowerCase();
      const normalizedAllowed = origins.map((o) => o.replace(/\/+$/, "").toLowerCase());
      if (!normalizedAllowed.includes(normalizedRequestOrigin)) {
        return fail(400, {
          error: `Current origin (${requestOrigin}) must be included in the allowed origins list to avoid locking yourself out.`,
        });
      }
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
    const retentionResult = AuditRetentionSchema.safeParse({
      days: sanitizeString(String(fd.get("audit_retention_days") ?? "")),
    });

    if (!retentionResult.success) {
      return fail(400, {
        error:
          retentionResult.error.issues[0]?.message ?? "Retention days must be a positive integer",
      });
    }

    const days = retentionResult.data.days;
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
