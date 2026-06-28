import { appendAuditLog } from "$lib/db/repositories/audit";
import { getUserMappingById, updateUserMapping } from "$lib/db/repositories/users";
import { AuditAction } from "$lib/db/types";
import type { DispatcharrClient } from "$lib/dispatcharr/client";
import { listChannelGroups } from "$lib/dispatcharr/endpoints/channel-groups";
import { listAllChannels } from "$lib/dispatcharr/endpoints/channels";
import { getUser, updateUser } from "$lib/dispatcharr/endpoints/users";
import type { DispatcharrResult } from "$lib/dispatcharr/types";
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

export interface GroupSubscriptionOutcome {
  /** The Dispatcharr channel profile IDs now assigned to the user (>= 1). */
  profileIds: number[];
  /** The normalized, validated group IDs that were enforced. */
  groupIds: number[];
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

  // Refuse to scope an admin-level user (profile filtering would not apply).
  const userResult = await retryResult(
    () => getUser(client, dispatcharrUserId),
    isTransientResultError,
  );
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
  const channelsResult = await retryResult(() => listAllChannels(client), isTransientResultError);
  if (!channelsResult.ok) {
    return { ok: false, error: channelsResult.error, message: channelsResult.message };
  }
  const groupChannelMap = buildGroupChannelMap(channelsResult.data);

  const groupsResult = await retryResult(() => listChannelGroups(client), isTransientResultError);
  if (!groupsResult.ok) {
    return { ok: false, error: groupsResult.error, message: groupsResult.message };
  }
  const groupNameById = new Map(groupsResult.data.map((g) => [g.id, g.name] as const));

  // Drop duplicates and any group that no longer exists in Dispatcharr.
  const requestedGroupIds = [...new Set(groupIds)].filter((id) => groupNameById.has(id));

  const resolvedProfileIds: number[] = [];
  if (requestedGroupIds.length === 0) {
    const empty = await ensureEmptyProfile(client);
    if (!empty.ok) return { ok: false, error: empty.error, message: empty.message };
    resolvedProfileIds.push(empty.data);
  } else {
    for (const groupId of requestedGroupIds) {
      const groupName = groupNameById.get(groupId) ?? `group ${groupId}`;
      const desired = new Set(groupChannelMap.get(groupId) ?? []);
      const profile = await reconcileGroupProfile(client, groupId, groupName, desired);
      if (!profile.ok) return { ok: false, error: profile.error, message: profile.message };
      resolvedProfileIds.push(profile.data);
    }
  }

  // Enforce on Dispatcharr. resolvedProfileIds is always non-empty here.
  const patch = await retryResult(
    () =>
      updateUser(client, dispatcharrUserId, {
        channel_profiles: resolvedProfileIds,
        user_level: PROVISIONED_USER_LEVEL,
      }),
    isTransientResultError,
  );
  if (!patch.ok) {
    return { ok: false, error: patch.error, message: patch.message };
  }

  // Persist intent locally. dispatcharr_profile_id holds the empty profile id
  // for a zero-group subscription (single profile), otherwise null — assigned
  // profiles are derivable from dispatcharr_group_ids + channel_group_profiles.
  const sortedGroupIds = [...requestedGroupIds].sort((a, b) => a - b);
  updateUserMapping(mappingId, {
    dispatcharr_group_ids: JSON.stringify(sortedGroupIds),
    dispatcharr_profile_id: requestedGroupIds.length === 0 ? (resolvedProfileIds[0] ?? null) : null,
  });

  appendAuditLog({
    actor: actorContext?.actor ?? "system",
    ipAddress: actorContext?.ipAddress,
    action: AuditAction.USER_GROUP_CHANGED,
    detail: {
      mapping_id: mappingId,
      group_ids: sortedGroupIds,
      profile_ids: resolvedProfileIds,
    },
  });

  return { ok: true, data: { profileIds: resolvedProfileIds, groupIds: sortedGroupIds } };
}
