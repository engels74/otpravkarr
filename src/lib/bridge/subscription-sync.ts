import { getAllUserMappings, updateLastSynced } from "$lib/db/repositories/users";
import type { UserMapping } from "$lib/db/types";
import type { DispatcharrClient } from "$lib/dispatcharr/client";
import { enforceLineupPolicySubscription } from "./subscriptions";

/**
 * Recompute every active subscriber from retained lineup intent. The bridge
 * resolver owns the approved/live/quarantine intersection and the low-level
 * apply owns materialized Dispatcharr IDs.
 */
export interface SubscriptionSyncReport {
  groupsReconciled: number;
  profilesRecreated: number;
  usersRepatched: number;
  errors: string[];
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
  const active = getAllUserMappings({ isActive: true }).filter(
    (mapping): mapping is UserMapping & { dispatcharr_user_id: number } =>
      mapping.dispatcharr_user_id != null && mapping.provisioning_mode !== "staff",
  );

  for (const mapping of active) {
    const result = await enforceLineupPolicySubscription(client, mapping.id);
    if (!result.ok) {
      report.errors.push(`User ${mapping.dispatcharr_user_id}: ${result.message}`);
      continue;
    }

    report.usersRepatched++;
    report.groupsReconciled += result.data.groupIds.length;
    try {
      updateLastSynced(mapping.id);
    } catch (err) {
      report.errors.push(
        `User ${mapping.dispatcharr_user_id}: Last Synced stamp failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return report;
}
