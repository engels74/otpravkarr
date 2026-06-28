import { getGroupProfile } from "$lib/db/repositories/channel-group-profiles";
import { getAllUserMappings, updateUserMapping } from "$lib/db/repositories/users";
import type { UserMapping } from "$lib/db/types";
import type { DispatcharrClient } from "$lib/dispatcharr/client";
import { listChannelGroups } from "$lib/dispatcharr/endpoints/channel-groups";
import { listAllChannels } from "$lib/dispatcharr/endpoints/channels";
import { updateUser } from "$lib/dispatcharr/endpoints/users";
import { fetchAllPages } from "$lib/dispatcharr/pagination";
import { DispatcharrUserSchema } from "$lib/dispatcharr/schemas";

import { isTransientResultError, retryResult } from "$lib/utils/retry";
import { buildGroupChannelMap, ensureEmptyProfile, reconcileGroupProfile } from "./group-profiles";
import { ADMIN_USER_LEVEL, PROVISIONED_USER_LEVEL } from "./subscriptions";

/**
 * Reconcile channel-group subscriptions against live Dispatcharr state.
 *
 * Leverages Model A's shared per-group profiles: each subscribed group's
 * profile membership is reconciled ONCE (correcting channels that moved between
 * groups, were added by plugins, etc.) and every subscriber inherits it — no
 * per-user channel work for ordinary membership drift.
 *
 * A user's `channel_profiles` is only re-asserted when its group-profile had to
 * be recreated (so its profile id changed and the user's stale reference must be
 * repointed). This keeps the job lightweight: typically zero per-user writes.
 *
 * Reconciliation never disables or reaps mappings (that is the lifecycle sync's
 * job, which already excludes the owner). The owner's self-subscription, being a
 * normal active mapping, is reconciled here like any other subscriber.
 */
export interface SubscriptionSyncReport {
  groupsReconciled: number;
  profilesRecreated: number;
  usersRepatched: number;
  errors: string[];
}

function parseGroupIds(raw: string): number[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is number => Number.isInteger(v));
  } catch {
    return [];
  }
}

export async function reconcileSubscriptions(
  client: DispatcharrClient,
): Promise<SubscriptionSyncReport> {
  const report: SubscriptionSyncReport = {
    groupsReconciled: 0,
    profilesRecreated: 0,
    usersRepatched: 0,
    errors: [],
  };

  // Active subscribers with a Dispatcharr account (includes the owner's
  // self-subscription, which is reconciled but never reaped here).
  const active = getAllUserMappings({ isActive: true }).filter(
    (m): m is UserMapping & { dispatcharr_user_id: number } => m.dispatcharr_user_id != null,
  );
  if (active.length === 0) return report;

  // Live state: bucket channels by group, and resolve group names.
  const channelsResult = await retryResult(() => listAllChannels(client), isTransientResultError);
  if (!channelsResult.ok) {
    report.errors.push(`Failed to list channels: ${channelsResult.message}`);
    return report;
  }
  const groupChannelMap = buildGroupChannelMap(channelsResult.data);

  const groupsResult = await retryResult(() => listChannelGroups(client), isTransientResultError);
  if (!groupsResult.ok) {
    report.errors.push(`Failed to list channel groups: ${groupsResult.message}`);
    return report;
  }
  const groupNameById = new Map(groupsResult.data.map((g) => [g.id, g.name] as const));

  // Remote user levels: never down-scope an admin/superuser. A Dispatcharr user
  // with user_level >= ADMIN_USER_LEVEL bypasses channel-profile filtering, so
  // forcing PROVISIONED_USER_LEVEL on it (below) would silently strip privileges.
  // The owner's is_owner self-subscription points at a SEPARATE non-admin account
  // and is unaffected — the guard is on remote user_level, not on is_owner.
  const usersResult = await retryResult(
    () => fetchAllPages(client, "/api/accounts/users/", DispatcharrUserSchema),
    isTransientResultError,
  );
  if (!usersResult.ok) {
    report.errors.push(`Failed to list users: ${usersResult.message}`);
    return report;
  }
  const userLevelById = new Map<number, number>(
    usersResult.data.map(
      (u) => [u.id, typeof u.user_level === "number" ? u.user_level : 0] as const,
    ),
  );

  // Per-mapping intended group ids (deduped; existing groups only), mirroring
  // applyGroupSubscription so duplicate stored ids never produce duplicate
  // resolved profile ids in the channel_profiles PATCH below.
  const intendedByMapping = new Map<number, number[]>();
  const subscribedGroupIds = new Set<number>();
  let anyZeroGroup = false;
  for (const m of active) {
    const ids = [...new Set(parseGroupIds(m.dispatcharr_group_ids))].filter((id) =>
      groupNameById.has(id),
    );
    intendedByMapping.set(m.id, ids);
    if (ids.length === 0) {
      anyZeroGroup = true;
    } else {
      for (const id of ids) subscribedGroupIds.add(id);
    }
  }

  // Reconcile each subscribed group's shared profile once. Track recreations so
  // only affected users get re-patched.
  const profileIdByGroup = new Map<number, number>();
  const recreatedGroupIds = new Set<number>();
  for (const groupId of subscribedGroupIds) {
    const previousProfileId = getGroupProfile(groupId)?.profile_id ?? null;
    const groupName = groupNameById.get(groupId) ?? `group ${groupId}`;
    const desired = new Set(groupChannelMap.get(groupId) ?? []);
    const result = await reconcileGroupProfile(client, groupId, groupName, desired);
    if (!result.ok) {
      report.errors.push(`Group ${groupId} (${groupName}): ${result.message}`);
      continue;
    }
    report.groupsReconciled++;
    profileIdByGroup.set(groupId, result.data);
    if (previousProfileId == null || previousProfileId !== result.data) {
      recreatedGroupIds.add(groupId);
      report.profilesRecreated++;
    }
  }

  // Empty profile for zero-group subscribers.
  let emptyProfileId: number | null = null;
  let emptyRecreated = false;
  if (anyZeroGroup) {
    const previousEmptyId = getGroupProfile(-1)?.profile_id ?? null;
    const emptyResult = await ensureEmptyProfile(client);
    if (emptyResult.ok) {
      emptyProfileId = emptyResult.data;
      emptyRecreated = previousEmptyId == null || previousEmptyId !== emptyResult.data;
    } else {
      report.errors.push(`Empty profile: ${emptyResult.message}`);
    }
  }

  // Re-patch only users whose resolved profile set may have changed (a profile
  // they reference was recreated this cycle).
  for (const m of active) {
    const ids = intendedByMapping.get(m.id) ?? [];
    let needsRepatch: boolean;
    let resolvedProfileIds: number[];

    if (ids.length === 0) {
      if (emptyProfileId == null) continue; // empty profile unavailable; skip
      resolvedProfileIds = [emptyProfileId];
      needsRepatch = emptyRecreated;
    } else {
      // Skip if any of the user's groups failed to resolve this cycle.
      const profiles = ids.map((id) => profileIdByGroup.get(id));
      if (profiles.some((p) => p == null)) continue;
      resolvedProfileIds = profiles as number[];
      needsRepatch = ids.some((id) => recreatedGroupIds.has(id));
    }

    if (!needsRepatch) continue;

    // Never down-scope an admin-level account: PATCHing user_level here would
    // strip its privileges. Skip and record it so the omission is observable.
    const remoteUserLevel = userLevelById.get(m.dispatcharr_user_id);
    if (remoteUserLevel != null && remoteUserLevel >= ADMIN_USER_LEVEL) {
      report.errors.push(
        `User ${m.dispatcharr_user_id}: skipped repatch — user_level ${remoteUserLevel} (>= ${ADMIN_USER_LEVEL}) bypasses channel-profile filtering`,
      );
      continue;
    }

    const patch = await retryResult(
      () =>
        updateUser(client, m.dispatcharr_user_id, {
          channel_profiles: resolvedProfileIds,
          user_level: PROVISIONED_USER_LEVEL,
        }),
      isTransientResultError,
    );
    if (!patch.ok) {
      report.errors.push(`User ${m.dispatcharr_user_id}: ${patch.message}`);
      continue;
    }
    report.usersRepatched++;
    try {
      updateUserMapping(m.id, {
        dispatcharr_profile_id: ids.length === 0 ? emptyProfileId : null,
      });
    } catch {
      // Local bookkeeping only; ignore.
    }
  }

  return report;
}
