import { appendAuditLog } from "$lib/db/repositories/audit";
import {
  EMPTY_PROFILE_GROUP_ID,
  getGroupProfile,
  getGroupProfilesByGroupIds,
} from "$lib/db/repositories/channel-group-profiles";
import { getUserMappingById, updateUserMapping } from "$lib/db/repositories/users";
import { AuditAction } from "$lib/db/types";
import type { DispatcharrClient } from "$lib/dispatcharr/client";
import { listChannelGroups } from "$lib/dispatcharr/endpoints/channel-groups";
import { listAllChannels } from "$lib/dispatcharr/endpoints/channels";
import { findUserByUsername, getUser, updateUser } from "$lib/dispatcharr/endpoints/users";
import type { DispatcharrResult } from "$lib/dispatcharr/types";
import { withDeadline } from "$lib/utils/deadline";
import { isTransientResultError, retryResult } from "$lib/utils/retry";
import { buildGroupChannelMap, ensureEmptyProfile, reconcileGroupProfile } from "./group-profiles";
import type { ActorContext } from "./lifecycle";

/**
 * `user_level >= 10` is admin/superuser in Dispatcharr and BYPASSES channel
 * profile filtering entirely — such a user always sees the full lineup. We
 * refuse to "scope" one (see brief 3.5 / 5).
 */
export const ADMIN_USER_LEVEL = 10;
/**
 * Non-admin level provisioned subscribers are set to. STANDARD (1) sees
 * channels with user_level <= 1 (channels default to 0) while staying below the
 * admin bypass. This is the maximum non-admin level, maximizing intended
 * visibility without granting the profile-filter bypass.
 */
export const PROVISIONED_USER_LEVEL = 1;
const INTERACTIVE_MUTATION_DEADLINE_MS = 8_000;

export interface GroupSubscriptionOutcome {
  /** The Dispatcharr channel profile IDs now assigned to the user (>= 1). */
  profileIds: number[];
  /** The normalized, validated group IDs that were enforced. */
  groupIds: number[];
}

/**
 * Parse a stored `dispatcharr_group_ids` JSON string into a normalized number[]:
 * positive safe integers only, deduped and sorted. Mirrors the boundary check at
 * the `changeGroup` input path and keeps the audit `before_group_ids` payload
 * consistent with the (already deduped/sorted) `group_ids` "after" state.
 */
function parseStoredGroupIds(raw: string): number[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const ids = parsed.filter((v): v is number => Number.isSafeInteger(v) && v > 0);
    return [...new Set(ids)].sort((a, b) => a - b);
  } catch {
    return [];
  }
}

async function getMappedDispatcharrUser(
  client: DispatcharrClient,
  mapping: NonNullable<ReturnType<typeof getUserMappingById>>,
) {
  if (mapping.dispatcharr_username) {
    const lookup = await retryResult(
      () => findUserByUsername(client, mapping.dispatcharr_username as string),
      isTransientResultError,
    );
    if (lookup.ok && lookup.data?.id === mapping.dispatcharr_user_id) {
      return { ok: true as const, data: lookup.data };
    }
    if (lookup.ok && lookup.data == null) {
      return {
        ok: false as const,
        error: "not_found" as const,
        message: `Dispatcharr user ${mapping.dispatcharr_username} not found`,
      };
    }
  }

  return retryResult(
    () => getUser(client, mapping.dispatcharr_user_id as number),
    isTransientResultError,
  );
}

/**
 * The single path that writes a user's channel-group subscription.
 *
 * Resolves the selected groups to otpravkarr-owned Channel Profiles (Model A),
 * ensures each profile is scoped to its group's current channels, then sets the
 * Dispatcharr user's `channel_profiles` to exactly that set and forces a
 * non-admin `user_level` so the scoping actually applies.
 *
 * Guarantees (brief 3.5):
 *  - The user is NEVER left with an empty `channel_profiles` array (which would
 *    expose the entire catalog). A zero-group subscription resolves to the
 *    shared empty profile (a real profile with zero enabled channels).
 *  - Refuses to scope an admin-level (`user_level >= 10`) Dispatcharr user,
 *    because profile filtering does not apply to it.
 *
 * Never throws for expected Dispatcharr failures — returns a DispatcharrResult.
 */
export async function applyGroupSubscription(
  client: DispatcharrClient,
  mappingId: number,
  groupIds: number[],
  actorContext?: ActorContext,
): Promise<DispatcharrResult<GroupSubscriptionOutcome>> {
  const mapping = getUserMappingById(mappingId);
  if (!mapping) {
    return { ok: false, error: "not_found", message: `User mapping ${mappingId} not found` };
  }
  if (mapping.dispatcharr_user_id == null) {
    return {
      ok: false,
      error: "validation_error",
      message: `User mapping ${mappingId} has no Dispatcharr user to scope`,
    };
  }
  const dispatcharrUserId = mapping.dispatcharr_user_id;

  // Snapshot the pre-write group assignment for the audit trail. `mapping` is
  // read once above and never re-read, so this is the true "before" state even
  // though the local mirror is only written near the end of this function.
  const beforeGroupIds = parseStoredGroupIds(mapping.dispatcharr_group_ids);

  // Refuse to scope an admin-level user (profile filtering would not apply).
  const userResult = await withDeadline(getMappedDispatcharrUser(client, mapping), 8_000, {
    ok: false,
    error: "network_error",
    message: "Timed out verifying Dispatcharr user",
  });
  if (!userResult.ok) {
    return { ok: false, error: userResult.error, message: userResult.message };
  }
  const remoteUserLevel =
    typeof userResult.data.user_level === "number" ? userResult.data.user_level : 0;
  if (remoteUserLevel >= ADMIN_USER_LEVEL) {
    return {
      ok: false,
      error: "validation_error",
      message: `Refusing to scope Dispatcharr user ${dispatcharrUserId}: user_level ${remoteUserLevel} (>= ${ADMIN_USER_LEVEL}) bypasses channel-profile filtering. Provision a separate non-admin subscriber instead.`,
    };
  }

  // Live channel + group state is the source of truth.
  const requestedGroupIds = [...new Set(groupIds)].sort((a, b) => a - b);
  const resolvedProfileIds: number[] = [];
  if (requestedGroupIds.length === 0) {
    const cachedEmptyProfileId = getGroupProfile(EMPTY_PROFILE_GROUP_ID)?.profile_id ?? null;
    if (cachedEmptyProfileId != null) {
      resolvedProfileIds.push(cachedEmptyProfileId);
    } else {
      const empty = await ensureEmptyProfile(client);
      if (!empty.ok) return { ok: false, error: empty.error, message: empty.message };
      resolvedProfileIds.push(empty.data);
    }
  } else {
    const cachedProfiles = getGroupProfilesByGroupIds(requestedGroupIds);
    if (cachedProfiles.size === requestedGroupIds.length) {
      resolvedProfileIds.push(
        ...requestedGroupIds.map((groupId) => cachedProfiles.get(groupId)?.profile_id as number),
      );
    } else {
      const channelsResult = await retryResult(
        () => listAllChannels(client),
        isTransientResultError,
      );
      if (!channelsResult.ok) {
        return { ok: false, error: channelsResult.error, message: channelsResult.message };
      }
      const groupChannelMap = buildGroupChannelMap(channelsResult.data);

      const groupsResult = await retryResult(
        () => listChannelGroups(client),
        isTransientResultError,
      );
      if (!groupsResult.ok) {
        return { ok: false, error: groupsResult.error, message: groupsResult.message };
      }
      const groupNameById = new Map(groupsResult.data.map((g) => [g.id, g.name] as const));

      if (!requestedGroupIds.every((id) => groupNameById.has(id))) {
        return { ok: false, error: "validation_error", message: "Invalid group IDs" };
      }

      for (const groupId of requestedGroupIds) {
        const groupName = groupNameById.get(groupId) ?? `group ${groupId}`;
        const desired = new Set(groupChannelMap.get(groupId) ?? []);
        const profile = await reconcileGroupProfile(client, groupId, groupName, desired);
        if (!profile.ok) return { ok: false, error: profile.error, message: profile.message };
        resolvedProfileIds.push(profile.data);
      }
    }
  }

  // Enforce on Dispatcharr. resolvedProfileIds is always non-empty here.
  const patch = await withDeadline(
    retryResult(
      () =>
        updateUser(client, dispatcharrUserId, {
          channel_profiles: resolvedProfileIds,
          user_level: PROVISIONED_USER_LEVEL,
        }),
      isTransientResultError,
    ),
    INTERACTIVE_MUTATION_DEADLINE_MS,
    {
      ok: false,
      error: "network_error",
      message: "Timed out updating Dispatcharr channel profiles",
    },
  );
  if (!patch.ok) {
    return { ok: false, error: patch.error, message: patch.message };
  }

  // Persist intent locally. dispatcharr_profile_id holds the empty profile id
  // for a zero-group subscription (single profile), otherwise null — assigned
  // profiles are derivable from dispatcharr_group_ids + channel_group_profiles.
  const sortedGroupIds = requestedGroupIds;

  // The Dispatcharr patch already landed. If the local mirror write throws
  // (constraint/schema/DB error) report a structured failure rather than let it
  // escape this function's no-throw DispatcharrResult contract — a stale local
  // mirror after a successful remote patch is a genuine inconsistency.
  try {
    updateUserMapping(mappingId, {
      dispatcharr_group_ids: JSON.stringify(sortedGroupIds),
      dispatcharr_profile_id:
        requestedGroupIds.length === 0 ? (resolvedProfileIds[0] ?? null) : null,
    });
  } catch (err) {
    return {
      ok: false,
      error: "server_error",
      message: `Dispatcharr user ${dispatcharrUserId} patched but local DB write failed (state may be inconsistent): ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Best-effort audit: the subscription has fully succeeded (remote patched, local
  // mirror written), so an audit-log failure must not mask it — nor, via the
  // provisioner's `!ok` teardown, destroy a correctly-scoped live subscriber.
  try {
    appendAuditLog({
      actor: actorContext?.actor ?? "system",
      ipAddress: actorContext?.ipAddress,
      action: AuditAction.USER_GROUP_CHANGED,
      detail: {
        mapping_id: mappingId,
        before_group_ids: beforeGroupIds,
        group_ids: sortedGroupIds,
        profile_ids: resolvedProfileIds,
      },
    });
  } catch (err) {
    console.warn(
      `Failed to append audit log for USER_GROUP_CHANGED (subscription succeeded): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { ok: true, data: { profileIds: resolvedProfileIds, groupIds: sortedGroupIds } };
}
