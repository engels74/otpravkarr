import { fail } from "@sveltejs/kit";
import { disableUser, enableUser, rotateCredentials } from "$lib/bridge/lifecycle";
import { provisionUser } from "$lib/bridge/provisioner";
import { appendAuditLog } from "$lib/db/repositories/audit";
import { getConfig } from "$lib/db/repositories/config";
import {
  getAllUserMappings,
  getUserMappingById,
  updateUserMapping,
} from "$lib/db/repositories/users";
import { AuditAction, type ProvisioningMode } from "$lib/db/types";
import { DispatcharrClient } from "$lib/dispatcharr/client";
import { listGroups } from "$lib/dispatcharr/endpoints/groups";
import { requireAdmin } from "$lib/server/auth";
import type { Actions, PageServerLoad } from "./$types";

function parseStoredGroupIds(rawGroupIds: string): number[] {
  try {
    const parsed: unknown = JSON.parse(rawGroupIds);
    if (
      !Array.isArray(parsed) ||
      !parsed.every((groupId) => typeof groupId === "number" && Number.isFinite(groupId))
    ) {
      return [];
    }

    return parsed;
  } catch {
    return [];
  }
}

async function getClient(): Promise<DispatcharrClient> {
  const url = await getConfig("dispatcharr_url");
  const key = await getConfig("dispatcharr_api_key");
  if (!url || !key) throw new Error("Dispatcharr not configured");
  return new DispatcharrClient(url, key);
}

export const load: PageServerLoad = async (event) => {
  await requireAdmin(event);
  const { url } = event;
  const status = url.searchParams.get("status") ?? "all";
  const mode = url.searchParams.get("mode") ?? "all";
  const search = url.searchParams.get("search") ?? "";

  let mappings = getAllUserMappings();

  // Apply filters in-memory
  if (status !== "all") {
    mappings = mappings.filter((m) => {
      if (status === "active") return m.is_active === 1 && m.dispatcharr_user_id != null;
      if (status === "inactive") return m.is_active === 0;
      if (status === "orphaned") return m.is_active === 1 && m.dispatcharr_user_id == null;
      return true;
    });
  }

  if (mode !== "all") {
    mappings = mappings.filter((m) => m.provisioning_mode === (mode as ProvisioningMode));
  }

  if (search.trim()) {
    const q = search.toLowerCase().trim();
    mappings = mappings.filter(
      (m) =>
        m.plex_username.toLowerCase().includes(q) ||
        (m.dispatcharr_username?.toLowerCase().includes(q) ?? false),
    );
  }

  // Fetch Dispatcharr groups
  let groups: { id: number; name: string }[] = [];

  try {
    const client = await getClient();
    const groupsResult = await listGroups(client);
    if (groupsResult.ok) groups = groupsResult.data;
  } catch {
    // Dispatcharr may not be configured yet — groups stay empty
  }

  return {
    mappings,
    groups,
    filters: { status, mode, search },
  };
};

export const actions: Actions = {
  rotateCredentials: async (event) => {
    await requireAdmin(event);
    const fd = await event.request.formData();
    const id = Number(fd.get("id"));
    if (!id) return fail(400, { error: "Missing user mapping ID" });

    const mapping = getUserMappingById(id);
    if (!mapping) return fail(400, { error: "User mapping not found" });

    try {
      const client = await getClient();
      await rotateCredentials(client, mapping);
      return { success: true };
    } catch (err) {
      return fail(500, {
        error: err instanceof Error ? err.message : "Failed to rotate credentials",
      });
    }
  },

  disableUser: async (event) => {
    await requireAdmin(event);
    const fd = await event.request.formData();
    const id = Number(fd.get("id"));
    if (!id) return fail(400, { error: "Missing user mapping ID" });

    const mapping = getUserMappingById(id);
    if (!mapping) return fail(400, { error: "User mapping not found" });

    try {
      const client = await getClient();
      await disableUser(client, mapping);
      return { success: true };
    } catch (err) {
      return fail(500, { error: err instanceof Error ? err.message : "Failed to disable user" });
    }
  },

  enableUser: async (event) => {
    await requireAdmin(event);
    const fd = await event.request.formData();
    const id = Number(fd.get("id"));
    if (!id) return fail(400, { error: "Missing user mapping ID" });

    const mapping = getUserMappingById(id);
    if (!mapping) return fail(400, { error: "User mapping not found" });

    try {
      const client = await getClient();

      if (mapping.dispatcharr_user_id != null) {
        // Dispatcharr user still exists — just re-enable locally
        await enableUser(client, mapping);
      } else {
        // Dispatcharr user was deleted during disable — re-provision
        const groupIds = parseStoredGroupIds(mapping.dispatcharr_group_ids);
        const plexToken = await getConfig("plex_admin_token");
        const result = await provisionUser(client, {
          plexIdentity: {
            id: mapping.plex_account_id,
            uuid: mapping.plex_uuid,
            username: mapping.plex_username,
            email: mapping.plex_email ?? "",
            thumb: mapping.plex_thumb ?? "",
            authenticationToken: plexToken ?? "",
          },
          mode: mapping.provisioning_mode,
          groupIds,
          profileId: mapping.dispatcharr_profile_id ?? undefined,
        });
        if (result.status === "failed") {
          return fail(500, { error: result.error });
        }
        // Surface the one-time password so the admin can communicate it
        if (result.status === "provisioned" && result.initialPassword) {
          return { success: true, initialPassword: result.initialPassword };
        }
      }

      return { success: true };
    } catch (err) {
      return fail(500, { error: err instanceof Error ? err.message : "Failed to enable user" });
    }
  },

  changeGroup: async (event) => {
    const admin = await requireAdmin(event);
    const fd = await event.request.formData();
    const id = Number(fd.get("id"));
    if (!id) return fail(400, { error: "Missing user mapping ID" });

    const mapping = getUserMappingById(id);
    if (!mapping) return fail(400, { error: "User mapping not found" });

    const groupIdsRaw = fd.get("group_ids");
    let groupIds: number[];
    try {
      groupIds = JSON.parse(String(groupIdsRaw ?? "[]")) as number[];
    } catch {
      return fail(400, { error: "Invalid group IDs" });
    }

    try {
      const before = parseStoredGroupIds(mapping.dispatcharr_group_ids);

      // Groups are tracked locally — the Dispatcharr User API does not have a groups field.
      // Group assignments on Dispatcharr are managed separately through the Groups API.
      updateUserMapping(id, { dispatcharr_group_ids: JSON.stringify(groupIds) });

      appendAuditLog({
        actor: admin.username,
        action: AuditAction.USER_GROUP_CHANGED,
        detail: {
          mapping_id: id,
          plex_username: mapping.plex_username,
          before,
          after: groupIds,
        },
        ipAddress: event.getClientAddress(),
      });

      return { success: true };
    } catch (err) {
      return fail(500, { error: err instanceof Error ? err.message : "Failed to change group" });
    }
  },

  changeProfile: async (event) => {
    await requireAdmin(event);
    return fail(400, {
      error:
        "Profile changes are currently unavailable because the Dispatcharr integration does not support propagating this update.",
    });
  },
};
