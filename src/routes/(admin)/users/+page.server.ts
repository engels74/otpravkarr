import { fail } from "@sveltejs/kit";
import type { z } from "zod";
import { disableUser, enableUser, rotateCredentialsForMappingId } from "$lib/bridge/lifecycle";
import { provisionUser } from "$lib/bridge/provisioner";
import { enforceLineupPolicySubscription } from "$lib/bridge/subscriptions";
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
import {
  createInteractiveClient,
  DispatcharrClient,
  IDLE_TIMEOUT_MS,
} from "$lib/dispatcharr/client";
import { listChannelGroups } from "$lib/dispatcharr/endpoints/channel-groups";
import { listProfiles } from "$lib/dispatcharr/endpoints/profiles";
import { updateUser } from "$lib/dispatcharr/endpoints/users";
import { fetchAllPages } from "$lib/dispatcharr/pagination";
import { DispatcharrUserSchema } from "$lib/dispatcharr/schemas";
import type { DispatcharrResult } from "$lib/dispatcharr/types";
import { getAccount } from "$lib/plex/client";
import type { PlexIdentity } from "$lib/plex/types";
import { requireAdmin } from "$lib/server/auth";
import {
  excludePlexOwnerNonSubscriberMappings,
  tryResolveConfiguredPlexOwnerAccountId,
} from "$lib/server/plex-owner";
import {
  getLineupBundleCatalog,
  getLineupPolicySettings,
  isQuarantineGroup,
  resolveLineupPolicy,
} from "$lib/server/subscription-config";
import { withDeadline } from "$lib/utils/deadline";
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

type ModeFilter = "all" | "automatic" | "self-managed" | "staff";

function normalizeModeFilter(rawMode: string | null): {
  filter: ModeFilter;
  provisioningMode: ProvisioningMode | null;
} {
  if (rawMode === "automatic" || rawMode === "staff") {
    return { filter: rawMode, provisioningMode: rawMode };
  }
  if (rawMode === "self-managed" || rawMode === "self_managed") {
    return { filter: "self-managed", provisioningMode: "self_managed" };
  }
  return { filter: "all", provisioningMode: null };
}

async function resolveDispatcharrCredentials(): Promise<[url: string, key: string]> {
  const url = await getConfig("dispatcharr_url");
  const key = await getConfig("dispatcharr_api_key");
  if (!url || !key) throw new Error("Dispatcharr not configured");
  return [url, key];
}

// Robust client (15s + idempotent retry) for the mutating actions
// (provisioning, credential rotation, group changes) — these are not on an
// idle-socket deadline and must not fast-fail.
async function getClient(): Promise<DispatcharrClient> {
  const [url, key] = await resolveDispatcharrCredentials();
  return new DispatcharrClient(url, key);
}

// Interactive client (short timeout, no retry) for the page LOAD only, so each
// underlying request also fails fast within the aggregate deadline below.
async function getInteractiveClient(): Promise<DispatcharrClient> {
  const [url, key] = await resolveDispatcharrCredentials();
  return createInteractiveClient(url, key);
}

// The /users Dispatcharr block is multi-phase (parallel groups+profiles, then a
// sequential paginated users fetch for drift), which a per-request timeout can't
// bound. An aggregate deadline degrades the whole block to empty so the page
// renders its DB rows inside the adapter idle window (ISSUE-002); the drift
// pagination — the likeliest long pole — gets a tighter inner bound so
// groups/profiles still render when only drift is slow. Both derive from
// IDLE_TIMEOUT (like INTERACTIVE_TIMEOUT_MS) so the load stays bounded even if a
// deployer tunes it below the 8s default; at the default 10s they are 8s / 6s. A
// 500ms floor (matching computeInteractiveTimeoutMs in client.ts) keeps both
// positive if IDLE_TIMEOUT is tuned to 1-2s, where the subtractions would
// otherwise cross zero and make withDeadline fire immediately — masking a
// healthy Dispatcharr as unreachable.
const USERS_DISPATCHARR_DEADLINE_MS = Math.max(500, Math.min(8_000, IDLE_TIMEOUT_MS - 1_000));
const USERS_DRIFT_DEADLINE_MS = Math.max(
  500,
  Math.min(6_000, USERS_DISPATCHARR_DEADLINE_MS - 1_000),
);

// Deadline for single-shot interactive admin mutations (changeProfile). Passed as
// the updateUser request timeout too, so ofetch aborts the in-flight PATCH at the
// deadline instead of orphaning it — mirrors the bridge mutation sites.
const INTERACTIVE_MUTATION_DEADLINE_MS = 8_000;

export const load: PageServerLoad = async (event) => {
  await requireAdmin(event);
  const { url } = event;
  const status = url.searchParams.get("status") ?? "all";
  const { filter: mode, provisioningMode } = normalizeModeFilter(url.searchParams.get("mode"));
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

  if (provisioningMode != null) {
    mappings = mappings.filter((m) => m.provisioning_mode === provisioningMode);
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
  // Per-mapping drift: does Dispatcharr's actual channel_profiles for the user
  // match the otpravkarr-owned profiles its stored group selection resolves to?
  type DispatcharrData = {
    groups: { id: number; name: string; channelCount: number | null }[];
    profiles: { id: number; name: string }[];
    driftByMappingId: Record<number, boolean>;
  };
  const EMPTY_DISPATCHARR_DATA: DispatcharrData = {
    groups: [],
    profiles: [],
    driftByMappingId: {},
  };

  const loadDispatcharrData = async (): Promise<DispatcharrData> => {
    let client: DispatcharrClient;
    try {
      client = await getInteractiveClient();
    } catch {
      // Dispatcharr may not be configured yet — degrade to empty.
      return EMPTY_DISPATCHARR_DATA;
    }

    const [groupsResult, profilesResult] = await Promise.all([
      listChannelGroups(client),
      listProfiles(client),
    ]);
    const groups = groupsResult.ok
      ? groupsResult.data
          .filter((g) => !isQuarantineGroup(g.name))
          .map((g) => ({ id: g.id, name: g.name, channelCount: g.channel_count ?? null }))
      : [];
    const profiles = profilesResult.ok
      ? profilesResult.data.map((p) => ({ id: p.id, name: p.name }))
      : [];

    // Compare each mapping's effective (remote) profile set with its intended
    // (resolved-from-group-ids) set to surface drift in the admin UI. This full
    // paginated fetch is the likeliest long pole, so bound it independently: on
    // timeout drift is simply left empty (badges don't render) while
    // groups/profiles above still show.
    const driftByMappingId: Record<number, boolean> = {};
    const usersResult = await withDeadline(
      fetchAllPages(client, "/api/accounts/users/", DispatcharrUserSchema),
      USERS_DRIFT_DEADLINE_MS,
      {
        ok: false,
        error: "network_error",
        message: "Drift fetch exceeded deadline",
      } as DispatcharrResult<z.infer<typeof DispatcharrUserSchema>[]>,
    );
    if (usersResult.ok) {
      const remoteByUserId = new Map<number, Set<number>>();
      for (const u of usersResult.data) {
        const cp = (u as { channel_profiles?: unknown }).channel_profiles;
        const ids = Array.isArray(cp) ? cp.filter((n): n is number => typeof n === "number") : [];
        remoteByUserId.set(u.id, new Set(ids));
      }
      const emptyProfileId = getGroupProfile(EMPTY_PROFILE_GROUP_ID)?.profile_id ?? null;
      const [settings, catalog] = await Promise.all([
        getLineupPolicySettings(),
        getLineupBundleCatalog(),
      ]);
      for (const m of mappings) {
        if (m.dispatcharr_user_id == null) continue;
        const effective = remoteByUserId.get(m.dispatcharr_user_id) ?? new Set<number>();
        const groupIds = resolveLineupPolicy({
          user: m,
          settings,
          catalog,
          liveGroups: groups,
        }).effectiveGroupIds;
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

    return { groups, profiles, driftByMappingId };
  };

  const { groups, profiles, driftByMappingId } = await withDeadline(
    loadDispatcharrData(),
    USERS_DISPATCHARR_DEADLINE_MS,
    EMPTY_DISPATCHARR_DATA,
  );
  const [policySettings, lineupBundleCatalog] = await Promise.all([
    getLineupPolicySettings(),
    getLineupBundleCatalog(),
  ]);
  const enabledBundleIds = new Set(
    lineupBundleCatalog.bundles.filter((bundle) => bundle.enabled).map((bundle) => bundle.id),
  );
  const policyByMappingId = Object.fromEntries(
    mappings.map((mapping) => {
      const resolution = resolveLineupPolicy({
        user: mapping,
        settings: policySettings,
        catalog: lineupBundleCatalog,
        liveGroups: groups,
      });
      const materializedGroupIds = parseStoredGroupIds(mapping.dispatcharr_group_ids);
      return [
        mapping.id,
        {
          ...resolution,
          materializedGroupIds,
          assignmentDrift:
            materializedGroupIds.length !== resolution.effectiveGroupIds.length ||
            materializedGroupIds.some((id) => !resolution.effectiveGroupIds.includes(id)),
          orphanBundleIds: resolution.selectedBundleIds.filter((id) => !enabledBundleIds.has(id)),
          orphanApprovedGroupIds: resolution.selectedApprovedGroupIds.filter(
            (id) => !resolution.effectiveGroupIds.includes(id),
          ),
        },
      ];
    }),
  );

  return {
    mappings,
    groups,
    profiles,
    driftByMappingId,
    filters: { status, mode, search },
    policySettings,
    lineupBundles: lineupBundleCatalog.bundles
      .filter((bundle) => bundle.enabled)
      .map(({ id, slug, displayName, groupIds }) => ({ id, slug, displayName, groupIds })),
    policyByMappingId,
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
      const updated = getUserMappingById(id);
      return {
        success: true,
        mappingId: updated?.id ?? mapping.id,
        isActive: updated?.is_active ?? 1,
        dispatcharrUserId: updated?.dispatcharr_user_id ?? null,
        dispatcharrUsername: updated?.dispatcharr_username ?? null,
        groupIds: parseStoredGroupIds(
          updated?.dispatcharr_group_ids ?? mapping.dispatcharr_group_ids,
        ),
        profileId: updated?.dispatcharr_profile_id ?? null,
        reprovisioned: false,
      };
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

      // Dispatcharr user was deleted during disable — re-provision with an empty
      // materialized set, then enforce the retained policy intent below.
      const groupIds: number[] = [];
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
          exposeInitialPassword: true,
        },
        { actor: admin.username, ipAddress: event.getClientAddress() },
      );
      if (result.status === "failed") {
        return fail(500, { error: result.error });
      }
      const enforced = await enforceLineupPolicySubscription(
        client,
        result.mapping.id,
        {},
        {
          actor: admin.username,
          ipAddress: event.getClientAddress(),
        },
      );
      if (!enforced.ok) return fail(502, { error: enforced.message });
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
        return {
          success: true,
          mappingId: result.mapping.id,
          reprovisioned: true,
          initialPassword: result.initialPassword,
          isActive: result.mapping.is_active,
          dispatcharrUserId: result.mapping.dispatcharr_user_id,
          dispatcharrUsername: result.mapping.dispatcharr_username,
          groupIds: parseStoredGroupIds(result.mapping.dispatcharr_group_ids),
          profileId: result.mapping.dispatcharr_profile_id,
        };
      }
      return {
        success: true,
        mappingId: result.mapping.id,
        reprovisioned: true,
        isActive: result.mapping.is_active,
        dispatcharrUserId: result.mapping.dispatcharr_user_id,
        dispatcharrUsername: result.mapping.dispatcharr_username,
        groupIds: parseStoredGroupIds(result.mapping.dispatcharr_group_ids),
        profileId: result.mapping.dispatcharr_profile_id,
      };
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
    const overrideRaw = fd.get("lineup_policy_override");
    let lineupPolicyOverride: "fixed" | "core_bundles" | "approved_selection" | null | undefined;
    if (overrideRaw != null) {
      const value = String(overrideRaw);
      if (value === "") lineupPolicyOverride = null;
      else if (value === "fixed" || value === "core_bundles" || value === "approved_selection") {
        lineupPolicyOverride = value;
      } else {
        return fail(400, { error: "Invalid lineup policy" });
      }
    }
    const bundleIdsRaw = fd.get("selected_bundle_ids");
    let selectedBundleIds: string[] | undefined;
    if (bundleIdsRaw != null) {
      try {
        const parsedBundleIds: unknown = JSON.parse(String(bundleIdsRaw));
        if (
          !Array.isArray(parsedBundleIds) ||
          !parsedBundleIds.every(
            (value): value is string => typeof value === "string" && value !== "",
          )
        ) {
          return fail(400, { error: "Invalid bundle IDs" });
        }
        selectedBundleIds = [...new Set(parsedBundleIds)];
      } catch {
        return fail(400, { error: "Invalid bundle IDs" });
      }
    }

    let client: DispatcharrClient;
    try {
      client = await getClient();
    } catch (err) {
      return fail(500, {
        error: err instanceof Error ? err.message : "Dispatcharr not configured",
      });
    }

    const result = await enforceLineupPolicySubscription(
      client,
      id,
      {
        ...(lineupPolicyOverride === undefined ? {} : { lineupPolicyOverride }),
        ...(selectedBundleIds === undefined ? {} : { selectedBundleIds }),
        selectedApprovedGroupIds: groupIds,
      },
      {
        actor: admin.username,
        ipAddress: event.getClientAddress(),
      },
    );
    if (!result.ok) {
      // A validation_error here means client-supplied group IDs were rejected
      // (e.g. stale/unknown IDs resolved against Dispatcharr) — a 4xx, not an
      // upstream outage. Every other error kind is a genuine 502.
      return fail(result.error === "validation_error" ? 400 : 502, { error: result.message });
    }

    return {
      success: true,
      groupIds: result.data.groupIds,
      profileIds: result.data.profileIds,
      profileId: result.data.groupIds.length === 0 ? (result.data.profileIds[0] ?? null) : null,
    };
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

    const groupIds: number[] = [];

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
    const enforced = await enforceLineupPolicySubscription(
      client,
      result.mapping.id,
      {},
      {
        actor: admin.username,
        ipAddress: event.getClientAddress(),
      },
    );
    if (!enforced.ok) return fail(502, { error: enforced.message });

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
      mapping: { ...result.mapping, dispatcharr_xc_password_enc: null },
      initialPassword: initialPassword ?? null,
    };
  },

  changeProfile: async (event) => {
    const admin = await requireAdmin(event);
    const fd = await event.request.formData();
    const id = Number(fd.get("id"));
    const profileIdRaw = fd.get("profile_id");
    if (!id) return fail(400, { error: "Missing user mapping ID" });
    if (typeof profileIdRaw !== "string" || !/^[1-9]\d*$/.test(profileIdRaw)) {
      return fail(400, { error: "Invalid profile ID" });
    }
    const profileId = Number(profileIdRaw);
    if (!Number.isSafeInteger(profileId)) return fail(400, { error: "Invalid profile ID" });

    const mapping = getUserMappingById(id);
    if (!mapping) return fail(400, { error: "User mapping not found" });
    if (mapping.dispatcharr_user_id == null) {
      return fail(400, { error: "User has no Dispatcharr account to update" });
    }

    const before = mapping.dispatcharr_profile_id;

    try {
      const client = await getClient();
      const updateRes = await withDeadline(
        updateUser(
          client,
          mapping.dispatcharr_user_id,
          {
            channel_profiles: [profileId],
          },
          INTERACTIVE_MUTATION_DEADLINE_MS,
        ),
        INTERACTIVE_MUTATION_DEADLINE_MS,
        {
          ok: false,
          error: "network_error",
          message: "Timed out updating Dispatcharr profile",
        },
      );
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

    return { success: true, profileId };
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
