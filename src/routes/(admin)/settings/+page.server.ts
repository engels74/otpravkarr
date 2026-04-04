import { fail } from "@sveltejs/kit";
import { appendAuditLog } from "$lib/db/repositories/audit";
import { getConfig, invalidateConfigCache, setConfig } from "$lib/db/repositories/config";
import { AuditAction } from "$lib/db/types";
import { DispatcharrClient } from "$lib/dispatcharr/client";
import { listGroups } from "$lib/dispatcharr/endpoints/groups";
import { listProfiles } from "$lib/dispatcharr/endpoints/profiles";
import type { Actions, PageServerLoad } from "./$types";

async function getClient(): Promise<DispatcharrClient | null> {
  const url = await getConfig("dispatcharr_url");
  const key = await getConfig("dispatcharr_api_key");
  if (!url || !key) return null;
  return new DispatcharrClient(url, key);
}

export const load: PageServerLoad = async () => {
  const [
    plexServerUrl,
    plexAdminToken,
    plexMachineId,
    dispatcharrUrl,
    dispatcharrApiKey,
    syncIntervalMinutes,
    defaultGroupId,
    defaultProfileId,
    defaultProvisioningMode,
    allowedOrigins,
    auditRetentionDays,
  ] = await Promise.all([
    getConfig("plex_server_url"),
    getConfig("plex_admin_token"),
    getConfig("plex_machine_id"),
    getConfig("dispatcharr_url"),
    getConfig("dispatcharr_api_key"),
    getConfig("sync_interval_minutes"),
    getConfig("default_group_id"),
    getConfig("default_profile_id"),
    getConfig("default_provisioning_mode"),
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

  // Fetch Dispatcharr groups and profiles for default selectors
  let groups: { id: number; name: string }[] = [];
  let profiles: { id: number; name: string }[] = [];

  try {
    const client = await getClient();
    if (client) {
      const [groupsResult, profilesResult] = await Promise.all([
        listGroups(client),
        listProfiles(client),
      ]);
      if (groupsResult.ok) groups = groupsResult.data;
      if (profilesResult.ok) profiles = profilesResult.data;
    }
  } catch {
    // Dispatcharr may not be configured yet
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
    provisioning: {
      defaultMode: defaultProvisioningMode ?? "automatic",
      defaultGroupId: defaultGroupId ?? "",
      defaultProfileId: defaultProfileId ?? "",
    },
    security: {
      allowedOrigins: originsText,
    },
    audit: {
      retentionDays: auditRetentionDays ?? "90",
    },
    groups,
    profiles,
  };
};

export const actions: Actions = {
  updatePlexConnection: async ({ request, locals, getClientAddress }) => {
    const fd = await request.formData();
    const serverUrl = String(fd.get("plex_server_url") ?? "").trim();
    const newToken = String(fd.get("plex_admin_token") ?? "").trim();

    const actor = locals.admin?.username ?? "unknown";
    const changedFields: string[] = [];

    await setConfig("plex_server_url", serverUrl);
    changedFields.push("plex_server_url");

    if (newToken) {
      await setConfig("plex_admin_token", newToken, true);
      changedFields.push("plex_admin_token");
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

  updateDispatcharrConnection: async ({ request, locals, getClientAddress }) => {
    const fd = await request.formData();
    const url = String(fd.get("dispatcharr_url") ?? "").trim();
    const newKey = String(fd.get("dispatcharr_api_key") ?? "").trim();

    const actor = locals.admin?.username ?? "unknown";
    const changedFields: string[] = [];

    await setConfig("dispatcharr_url", url);
    changedFields.push("dispatcharr_url");

    if (newKey) {
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

  updateSyncSettings: async ({ request, locals, getClientAddress }) => {
    const fd = await request.formData();
    const raw = String(fd.get("sync_interval_minutes") ?? "").trim();
    const interval = Number.parseInt(raw, 10);

    if (!Number.isFinite(interval) || interval < 1) {
      return fail(400, { error: "Sync interval must be a positive integer" });
    }

    const actor = locals.admin?.username ?? "unknown";

    await setConfig("sync_interval_minutes", String(interval));
    invalidateConfigCache();

    appendAuditLog({
      actor,
      action: AuditAction.CONFIG_CHANGED,
      detail: { section: "sync", field: "sync_interval_minutes", value: interval },
      ipAddress: getClientAddress(),
    });

    return { success: true };
  },

  updateDefaultProvisioning: async ({ request, locals, getClientAddress }) => {
    const fd = await request.formData();
    const mode = String(fd.get("default_provisioning_mode") ?? "").trim();
    const groupId = String(fd.get("default_group_id") ?? "").trim();
    const profileId = String(fd.get("default_profile_id") ?? "").trim();

    const validModes = ["automatic", "self_managed", "staff"];
    if (!validModes.includes(mode)) {
      return fail(400, { error: "Invalid provisioning mode" });
    }

    const actor = locals.admin?.username ?? "unknown";

    await Promise.all([
      setConfig("default_provisioning_mode", mode),
      setConfig("default_group_id", groupId),
      setConfig("default_profile_id", profileId),
    ]);
    invalidateConfigCache();

    appendAuditLog({
      actor,
      action: AuditAction.CONFIG_CHANGED,
      detail: {
        section: "provisioning",
        defaultMode: mode,
        defaultGroupId: groupId,
        defaultProfileId: profileId,
      },
      ipAddress: getClientAddress(),
    });

    return { success: true };
  },

  updateSecurity: async ({ request, locals, getClientAddress }) => {
    const fd = await request.formData();
    const raw = String(fd.get("allowed_origins") ?? "").trim();

    // Parse newline-separated origins into JSON array
    const origins = raw
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

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

  updateAuditRetention: async ({ request, locals, getClientAddress }) => {
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
