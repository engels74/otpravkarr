import { queryAuditLog } from "$lib/db/repositories/audit";
import { getAllUserMappings } from "$lib/db/repositories/users";
import type { ProvisioningMode } from "$lib/db/types";
import { getCachedFriends } from "$lib/plex/friends";
import { getHealthStatus } from "$lib/scheduler/jobs/health";
import { scheduler } from "$lib/scheduler/runner";
import { requireAdmin } from "$lib/server/auth";
import {
  excludePlexOwnerMappings,
  tryResolveConfiguredPlexOwnerAccountId,
} from "$lib/server/plex-owner";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async (event) => {
  await requireAdmin(event);
  const ownerPlexAccountId = await tryResolveConfiguredPlexOwnerAccountId();
  const mappings = excludePlexOwnerMappings(getAllUserMappings(), ownerPlexAccountId);

  // User stats
  const total = mappings.length;
  const active = mappings.filter((m) => m.is_active === 1).length;
  const inactive = mappings.filter((m) => m.is_active === 0).length;
  const orphaned = mappings.filter(
    (m) => m.is_active === 1 && m.dispatcharr_user_id == null,
  ).length;

  const byMode: Record<ProvisioningMode, number> = { automatic: 0, self_managed: 0, staff: 0 };
  for (const m of mappings) {
    byMode[m.provisioning_mode] = (byMode[m.provisioning_mode] ?? 0) + 1;
  }

  // Health status
  const health = getHealthStatus();

  // Job statuses
  const syncJob = scheduler.getJobStatus("plex-dispatcharr-sync") ?? null;
  const healthJob = scheduler.getJobStatus("health-check") ?? null;

  // Recent audit entries
  const { entries: recentAudit } = queryAuditLog({ limit: 10 });

  // Available Plex friends (accepted friends not already mapped)
  const cachedFriends = getCachedFriends();
  const mappedPlexIds = new Set(mappings.map((m) => m.plex_account_id));
  const availableFriends = cachedFriends
    ? cachedFriends.filter(
        (f) => f.status === "accepted" && f.id !== ownerPlexAccountId && !mappedPlexIds.has(f.id),
      )
    : null;

  return {
    userStats: { total, active, inactive, orphaned, byMode },
    health,
    syncJob,
    healthJob,
    recentAudit,
    availableFriends,
  };
};
