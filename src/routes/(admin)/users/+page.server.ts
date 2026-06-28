import { fail } from "@sveltejs/kit";
import { disableUser, enableUser, rotateCredentialsForMappingId } from "$lib/bridge/lifecycle";
import { provisionUser } from "$lib/bridge/provisioner";
import { applyGroupSubscription } from "$lib/bridge/subscriptions";
import { db } from "$lib/db/connection";

import { appendAuditLog } from "$lib/db/repositories/audit";
import {
  EMPTY_PROFILE_GROUP_ID,
  getGroupProfile,
  getGroupProfilesByGroupIds,
} from "$lib/db/repositories/channel-group-profiles";
import { getConfig } from "$lib/db/repositories/config";
import { deleteUserSessionsByUserRef } from "$lib/db/repositories/sessions";
import {
  deleteUserMapping,
  getAllUserMappings,
  getUserMappingById,
  updateUserMapping,
} from "$lib/db/repositories/users";
import { AuditAction, type ProvisioningMode } from "$lib/db/types";
import { DispatcharrClient } from "$lib/dispatcharr/client";
import { listChannelGroups } from "$lib/dispatcharr/endpoints/channel-groups";
import { listProfiles } from "$lib/dispatcharr/endpoints/profiles";
import { updateUser } from "$lib/dispatcharr/endpoints/users";
import { fetchAllPages } from "$lib/dispatcharr/pagination";
import { DispatcharrUserSchema } from "$lib/dispatcharr/schemas";
import { getAccount } from "$lib/plex/client";
import type { PlexIdentity } from "$lib/plex/types";
import { requireAdmin } from "$lib/server/auth";
import {
  excludePlexOwnerNonSubscriberMappings,
  tryResolveConfiguredPlexOwnerAccountId,
} from "$lib/server/plex-owner";
import {
  computeOfferedGroups,
  defaultSelectedGroupIds,
  getSubscriptionDefaults,
  isQuarantineGroup,
} from "$lib/server/subscription-config";
import { isTransientResultError, retryResult } from "$lib/utils/retry";
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

  const ownerPlexAccountId = await tryResolveConfiguredPlexOwnerAccountId();
  let mappings = excludePlexOwnerNonSubscriberMappings(getAllUserMappings(), ownerPlexAccountId);

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

  // Fetch live Dispatcharr CHANNEL groups (the subscribable unit) + channel
  // profiles. Quarantine groups (Graveyard/Slow/Black Screens) are excluded.
  let groups: { id: number; name: string; channelCount: number | null }[] = [];
  let profiles: { id: number; name: string }[] = [];
  // Per-mapping drift: does Dispatcharr's actual channel_profiles for the user
  // match the otpravkarr-owned profiles its stored group selection resolves to?
  const driftByMappingId: Record<number, boolean> = {};

  try {
    const client = await getClient();
    const [groupsResult, profilesResult] = await Promise.all([
      listChannelGroups(client),
      listProfiles(client),
    ]);
    if (groupsResult.ok) {
      groups = groupsResult.data
        .filter((g) => !isQuarantineGroup(g.name))
        .map((g) => ({ id: g.id, name: g.name, channelCount: g.channel_count ?? null }));
    }
    if (profilesResult.ok) {
      profiles = profilesResult.data.map((p) => ({ id: p.id, name: p.name }));
    }

    // Compare each mapping's effective (remote) profile set with its intended
    // (resolved-from-group-ids) set to surface drift in the admin UI.
    const usersResult = await fetchAllPages(client, "/api/accounts/users/", DispatcharrUserSchema);
    if (usersResult.ok) {
      const remoteByUserId = new Map<number, Set<number>>();
      for (const u of usersResult.data) {
        const cp = (u as { channel_profiles?: unknown }).channel_profiles;
        const ids = Array.isArray(cp) ? cp.filter((n): n is number => typeof n === "number") : [];
        remoteByUserId.set(u.id, new Set(ids));
      }
      const emptyProfileId = getGroupProfile(EMPTY_PROFILE_GROUP_ID)?.profile_id ?? null;
      for (const m of mappings) {
        if (m.dispatcharr_user_id == null) continue;
        const effective = remoteByUserId.get(m.dispatcharr_user_id) ?? new Set<number>();
        const groupIds = parseStoredGroupIds(m.dispatcharr_group_ids);
        // Resolve stored group ids to their otpravkarr-owned profiles once.
        // getGroupProfilesByGroupIds silently omits ids with no local
        // channel_group_profiles row, so a stored group whose mapping was
        // deleted/never created (orphan) shrinks `intended` and could let a
        // genuinely missing profile slip past the size/membership checks below
        // (drift=false false-negative). Dedup first so duplicate ids don't read
        // as "incomplete" against a Map that collapses them by key.
        const uniqueGroupIds = [...new Set(groupIds)];
        const resolvedMap = getGroupProfilesByGroupIds(uniqueGroupIds);
        const incompleteResolution =
          groupIds.length > 0 && resolvedMap.size < uniqueGroupIds.length;
        const intended =
          groupIds.length === 0
            ? new Set(emptyProfileId == null ? [] : [emptyProfileId])
            : new Set([...resolvedMap.values()].map((p) => p.profile_id));
        // brief 3.5: a provisioned user must NEVER have empty channel_profiles
        // (that exposes the entire catalog) — a zero-group subscription resolves
        // to the empty profile, not []. So an empty effective set is always
        // drift, even when `intended` is also empty (e.g. the empty-profile
        // sentinel is missing), which the size/membership checks would otherwise
        // treat as a match and silently hide the dangerous state.
        driftByMappingId[m.id] =
          incompleteResolution ||
          effective.size === 0 ||
          effective.size !== intended.size ||
          [...intended].some((id) => !effective.has(id));
      }
    }
  } catch {
    // Dispatcharr may not be configured yet — groups/profiles stay empty
  }

  return {
    mappings,
    groups,
    profiles,
    driftByMappingId,
    filters: { status, mode, search },
  };
};

export const actions: Actions = {
  rotateCredentials: async (event) => {
    const admin = await requireAdmin(event);
    const fd = await event.request.formData();
    const id = Number(fd.get("id"));
    if (!id) return fail(400, { error: "Missing user mapping ID" });

    const mapping = getUserMappingById(id);
    if (!mapping) return fail(400, { error: "User mapping not found" });

    try {
      const client = await getClient();
      await rotateCredentialsForMappingId(client, mapping.id, {
        actor: admin.username,
        ipAddress: event.getClientAddress(),
      });
      return { success: true };
    } catch (err) {
      return fail(500, {
        error: err instanceof Error ? err.message : "Failed to rotate credentials",
      });
    }
  },

  disableUser: async (event) => {
    const admin = await requireAdmin(event);
    const fd = await event.request.formData();
    const id = Number(fd.get("id"));
    if (!id) return fail(400, { error: "Missing user mapping ID" });

    const mapping = getUserMappingById(id);
    if (!mapping) return fail(400, { error: "User mapping not found" });

    try {
      const client = await getClient();
      await disableUser(client, mapping, {
        actor: admin.username,
        ipAddress: event.getClientAddress(),
      });
      return { success: true };
    } catch (err) {
      return fail(500, { error: err instanceof Error ? err.message : "Failed to disable user" });
    }
  },

  enableUser: async (event) => {
    const admin = await requireAdmin(event);
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
        try {
          appendAuditLog({
            actor: admin.username,
            action: AuditAction.USER_RE_ENABLED,
            detail: { mapping_id: id, plex_username: mapping.plex_username, reprovisioned: false },
            ipAddress: event.getClientAddress(),
          });
        } catch (err) {
          // audit log failure should not mask the successful re-enable
          console.warn(
            `Failed to append audit log for USER_RE_ENABLED: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        return { success: true };
      }

      // Dispatcharr user was deleted during disable — re-provision
      const groupIds = parseStoredGroupIds(mapping.dispatcharr_group_ids);
      const plexToken = await getConfig("plex_admin_token");
      const result = await provisionUser(
        client,
        {
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
          exposeInitialPassword: true,
        },
        { actor: admin.username, ipAddress: event.getClientAddress() },
      );
      if (result.status === "failed") {
        return fail(500, { error: result.error });
      }
      try {
        appendAuditLog({
          actor: admin.username,
          action: AuditAction.USER_RE_ENABLED,
          detail: { mapping_id: id, plex_username: mapping.plex_username, reprovisioned: true },
          ipAddress: event.getClientAddress(),
        });
      } catch (err) {
        // audit log failure must not mask the successful re-provision —
        // otherwise the OTP returned by provisionUser is irrecoverable.
        console.warn(
          `Failed to append audit log for USER_RE_ENABLED (re-provisioned): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      // Surface the one-time password so the admin can communicate it.
      if (result.status === "provisioned" && result.initialPassword) {
        return { success: true, reprovisioned: true, initialPassword: result.initialPassword };
      }
      return { success: true, reprovisioned: true };
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
    if (mapping.dispatcharr_user_id == null) {
      return fail(400, { error: "User has no Dispatcharr account to update" });
    }

    const groupIdsRaw = fd.get("group_ids");
    let parsedGroupIds: unknown;
    try {
      parsedGroupIds = JSON.parse(String(groupIdsRaw ?? "[]"));
    } catch {
      return fail(400, { error: "Invalid group IDs" });
    }
    if (
      !Array.isArray(parsedGroupIds) ||
      !parsedGroupIds.every((v): v is number => Number.isInteger(v) && v > 0)
    ) {
      return fail(400, { error: "Invalid group IDs" });
    }
    const groupIds: number[] = parsedGroupIds;

    let client: DispatcharrClient;
    try {
      client = await getClient();
    } catch (err) {
      return fail(500, {
        error: err instanceof Error ? err.message : "Dispatcharr not configured",
      });
    }

    // applyGroupSubscription filters submitted ids by LIVE EXISTENCE only, so a
    // crafted request could assign a quarantine group (Graveyard/Slow/Black
    // Screens) the admin UI hides everywhere. Reject any id that isn't a live,
    // non-quarantine group. Fail closed if the live list is unavailable. An empty
    // selection still passes ([].every is true) and resolves to the empty profile.
    const groupsResult = await retryResult(() => listChannelGroups(client), isTransientResultError);
    if (!groupsResult.ok) {
      return fail(502, { error: "Unable to fetch channel groups. Please try again." });
    }
    const liveNonQuarantineIds = new Set(
      groupsResult.data.filter((g) => !isQuarantineGroup(g.name)).map((g) => g.id),
    );
    if (!groupIds.every((id) => liveNonQuarantineIds.has(id))) {
      return fail(400, { error: "Invalid group IDs" });
    }

    // applyGroupSubscription is the single path that enforces the subscription
    // on Dispatcharr (Model A), persists the group set, and writes the audit
    // entry. An empty selection resolves to the empty profile (zero channels),
    // never an empty channel_profiles array (which would expose everything).
    const result = await applyGroupSubscription(client, id, groupIds, {
      actor: admin.username,
      ipAddress: event.getClientAddress(),
    });
    if (!result.ok) {
      return fail(502, { error: result.message });
    }

    return { success: true };
  },

  setGroupLock: async (event) => {
    const admin = await requireAdmin(event);
    const fd = await event.request.formData();
    const id = Number(fd.get("id"));
    if (!id) return fail(400, { error: "Missing user mapping ID" });

    const mapping = getUserMappingById(id);
    if (!mapping) return fail(400, { error: "User mapping not found" });

    const locked = String(fd.get("locked") ?? "") === "true";

    try {
      updateUserMapping(id, { group_selection_locked: locked ? 1 : 0 });
    } catch (err) {
      return fail(500, { error: err instanceof Error ? err.message : "Failed to update lock" });
    }

    try {
      appendAuditLog({
        actor: admin.username,
        action: AuditAction.USER_LOCK_CHANGED,
        detail: { mapping_id: id, plex_username: mapping.plex_username, locked },
        ipAddress: event.getClientAddress(),
      });
    } catch (err) {
      console.warn(
        `Failed to append audit log for USER_LOCK_CHANGED: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return { success: true };
  },

  // Provision the Plex owner as their OWN non-admin Xtream subscriber, separate
  // from their Dispatcharr superuser account (which bypasses profile scoping —
  // brief 5). The mapping is flagged is_owner=1 and, sharing the owner's Plex
  // account id, is automatically excluded from friend-sync reaping.
  subscribeOwner: async (event) => {
    const admin = await requireAdmin(event);

    const plexToken = await getConfig("plex_admin_token");
    if (!plexToken) {
      return fail(400, { error: "Plex admin token is not configured." });
    }

    let account: Awaited<ReturnType<typeof getAccount>>;
    try {
      account = await getAccount(plexToken);
    } catch {
      return fail(502, { error: "Could not resolve your Plex account." });
    }
    const raw = account as unknown as Record<string, unknown>;
    const accountId = typeof raw.id === "number" ? raw.id : Number(raw.id);
    if (!Number.isFinite(accountId)) {
      return fail(502, { error: "Plex returned an unexpected account id." });
    }
    const ownerIdentity: PlexIdentity = {
      id: accountId,
      uuid: typeof raw.uuid === "string" ? raw.uuid : String(accountId),
      username: typeof raw.username === "string" ? raw.username : "owner",
      email: typeof raw.email === "string" ? raw.email : "",
      thumb: typeof raw.thumb === "string" ? raw.thumb : "",
      authenticationToken: plexToken,
    };

    let client: DispatcharrClient;
    try {
      client = await getClient();
    } catch (err) {
      return fail(500, {
        error: err instanceof Error ? err.message : "Dispatcharr not configured",
      });
    }

    // Default the owner to every admin-offered group. Fail closed if the live
    // group list is unavailable: a silent empty result would provision the owner
    // to the empty profile (zero channels) and report success.
    const defaults = await getSubscriptionDefaults();
    const groupsResult = await retryResult(() => listChannelGroups(client), isTransientResultError);
    if (!groupsResult.ok) {
      return fail(502, { error: "Unable to fetch channel groups. Please try again." });
    }
    const groupIds = defaultSelectedGroupIds(computeOfferedGroups(groupsResult.data, defaults));

    const result = await provisionUser(
      client,
      {
        plexIdentity: ownerIdentity,
        mode: "automatic",
        groupIds,
        isOwner: true,
        exposeInitialPassword: true,
      },
      { actor: admin.username, ipAddress: event.getClientAddress() },
    );

    if (result.status === "failed") {
      return fail(502, { error: result.error });
    }
    if (result.status === "already_exists") {
      return fail(400, {
        error: "You already have a subscriber account — manage it from the user list.",
      });
    }

    try {
      updateUserMapping(result.mapping.id, { is_owner: 1 });
    } catch {
      // Best-effort: provisionUser already set is_owner on create.
    }

    try {
      appendAuditLog({
        actor: admin.username,
        action: AuditAction.USER_OWNER_SUBSCRIBED,
        detail: {
          mapping_id: result.mapping.id,
          dispatcharr_username: result.mapping.dispatcharr_username,
        },
        ipAddress: event.getClientAddress(),
      });
    } catch (err) {
      console.warn(
        `Failed to append audit log for USER_OWNER_SUBSCRIBED: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const initialPassword = result.status === "provisioned" ? result.initialPassword : undefined;
    return {
      success: true,
      ownerSubscribed: true,
      dispatcharrUsername: result.mapping.dispatcharr_username,
      initialPassword: initialPassword ?? null,
    };
  },

  changeProfile: async (event) => {
    const admin = await requireAdmin(event);
    const fd = await event.request.formData();
    const id = Number(fd.get("id"));
    const profileIdRaw = fd.get("profile_id");
    const profileId = profileIdRaw === "" || profileIdRaw == null ? null : Number(profileIdRaw);
    if (!id) return fail(400, { error: "Missing user mapping ID" });
    if (profileId !== null && (!Number.isInteger(profileId) || profileId <= 0)) {
      return fail(400, { error: "Invalid profile ID" });
    }

    const mapping = getUserMappingById(id);
    if (!mapping) return fail(400, { error: "User mapping not found" });
    if (mapping.dispatcharr_user_id == null) {
      return fail(400, { error: "User has no Dispatcharr account to update" });
    }

    const before = mapping.dispatcharr_profile_id;

    try {
      const client = await getClient();
      const updateRes = await updateUser(client, mapping.dispatcharr_user_id, {
        channel_profiles: profileId == null ? [] : [profileId],
      });
      if (!updateRes.ok) return fail(500, { error: updateRes.message });
      updateUserMapping(id, { dispatcharr_profile_id: profileId });
    } catch (err) {
      return fail(500, {
        error: err instanceof Error ? err.message : "Failed to change profile",
      });
    }

    try {
      appendAuditLog({
        actor: admin.username,
        action: AuditAction.USER_PROFILE_CHANGED,
        detail: {
          mapping_id: id,
          plex_username: mapping.plex_username,
          before,
          after: profileId,
        },
        ipAddress: event.getClientAddress(),
      });
    } catch (err) {
      // audit log failure should not mask the successful profile change
      console.warn(
        `Failed to append audit log for USER_PROFILE_CHANGED: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return { success: true };
  },

  deleteMapping: async (event) => {
    const admin = await requireAdmin(event);
    const fd = await event.request.formData();
    const rawId = fd.get("id");
    if (typeof rawId !== "string" || !/^[1-9]\d*$/.test(rawId)) {
      return fail(400, { error: "Missing user mapping ID" });
    }

    const id = Number(rawId);
    if (!Number.isSafeInteger(id)) {
      return fail(400, { error: "Missing user mapping ID" });
    }

    const mapping = getUserMappingById(id);
    if (!mapping) return fail(400, { error: "User mapping not found" });
    if (mapping.dispatcharr_user_id != null || mapping.dispatcharr_xc_password_enc != null) {
      return fail(400, { error: "Disable the user before deleting the local mapping." });
    }

    try {
      db.transaction(() => {
        deleteUserSessionsByUserRef(String(mapping.id));
        if (!deleteUserMapping(mapping.id)) {
          throw new Error("Failed to delete local mapping");
        }
      })();
    } catch (err) {
      return fail(500, {
        error: err instanceof Error ? err.message : "Failed to delete local mapping",
      });
    }

    try {
      appendAuditLog({
        actor: admin.username,
        action: AuditAction.USER_MAPPING_DELETED,
        detail: {
          mapping_id: mapping.id,
          plex_username: mapping.plex_username,
          plex_account_id: mapping.plex_account_id,
          provisioning_mode: mapping.provisioning_mode,
          was_active: mapping.is_active === 1,
        },
        ipAddress: event.getClientAddress(),
      });
    } catch (err) {
      // audit log failure should not mask the successful local delete
      console.warn(
        `Failed to append audit log for USER_MAPPING_DELETED: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return { success: true };
  },
};
