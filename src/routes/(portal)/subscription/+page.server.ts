import { fail, redirect } from "@sveltejs/kit";
import { enforceLineupPolicySubscription } from "$lib/bridge/subscriptions";
import { getConfig } from "$lib/db/repositories/config";
import { getUserMappingById } from "$lib/db/repositories/users";
import { DispatcharrClient } from "$lib/dispatcharr/client";
import { listChannelGroups } from "$lib/dispatcharr/endpoints/channel-groups";
import { requireUser } from "$lib/server/auth";
import {
  computeOfferedGroups,
  getLineupBundleCatalog,
  getLineupPolicySettings,
  getSubscriptionDefaults,
  isQuarantineGroup,
  resolveLineupPolicy,
} from "$lib/server/subscription-config";
import type { Actions, PageServerLoad } from "./$types";

async function getClient(): Promise<DispatcharrClient | null> {
  const [url, key] = await Promise.all([
    getConfig("dispatcharr_url"),
    getConfig("dispatcharr_api_key"),
  ]);
  if (!url || !key) return null;
  return new DispatcharrClient(url, key);
}

export const load: PageServerLoad = async (event) => {
  const user = await requireUser(event);

  const [defaults, settings, catalog] = await Promise.all([
    getSubscriptionDefaults(),
    getLineupPolicySettings(),
    getLineupBundleCatalog(),
  ]);
  const adminLocked = user.group_selection_locked === 1 || !defaults.allowSelfSelect;
  let policy = settings.defaultPolicy;
  let effectiveGroupIds: number[] = [];
  let selectedBundleIds: string[] = [];
  let offered: { id: number; name: string; channelCount: number | null }[] = [];
  let assignedGroups: { id: number; name: string; channelCount: number | null }[] = [];
  const bundles = catalog.bundles
    .filter((bundle) => bundle.enabled)
    .map((bundle) => ({
      id: bundle.id,
      displayName: bundle.displayName,
      groupIds: bundle.groupIds,
    }));

  const client = await getClient();
  if (client) {
    const groupsResult = await listChannelGroups(client);
    if (groupsResult.ok) {
      const resolution = resolveLineupPolicy({
        user,
        settings,
        catalog,
        liveGroups: groupsResult.data,
      });
      policy = resolution.policy;
      effectiveGroupIds = resolution.effectiveGroupIds;
      selectedBundleIds = resolution.selectedBundleIds.filter((id) =>
        bundles.some((bundle) => bundle.id === id),
      );
      if (policy === "approved_selection") {
        offered = computeOfferedGroups(groupsResult.data, defaults).map((group) => ({
          id: group.id,
          name: group.name,
          channelCount: group.channel_count ?? null,
        }));
      }
      const effectiveIds = new Set(effectiveGroupIds);
      assignedGroups = groupsResult.data
        .filter((group) => !isQuarantineGroup(group.name) && effectiveIds.has(group.id))
        .map((group) => ({
          id: group.id,
          name: group.name,
          channelCount: group.channel_count ?? null,
        }));
    }
  }

  const offeredIds = new Set(offered.map((group) => group.id));
  const selected = effectiveGroupIds.filter((id) => offeredIds.has(id));

  return {
    plexUsername: user.plex_username,
    policy,
    bundles,
    selectedBundleIds,
    offered,
    selected,
    assignedGroups,
    locked: adminLocked || policy === "fixed",
    saved: event.url.searchParams.get("saved") === "1",
  };
};

export const actions: Actions = {
  save: async (event) => {
    const user = await requireUser(event);

    const defaults = await getSubscriptionDefaults();
    if (user.group_selection_locked === 1 || !defaults.allowSelfSelect) {
      return fail(403, { error: "Your channel selection is managed by the administrator." });
    }

    const mapping = getUserMappingById(user.id);
    if (!mapping || mapping.dispatcharr_user_id == null) {
      return fail(400, { error: "Your account is not fully provisioned yet." });
    }

    const formData = await event.request.formData();
    let parsedGroupIds: unknown;
    let parsedBundleIds: unknown;
    try {
      parsedGroupIds = JSON.parse(String(formData.get("group_ids") ?? "[]"));
      parsedBundleIds = JSON.parse(String(formData.get("bundle_ids") ?? "[]"));
    } catch {
      return fail(400, { error: "Invalid selection." });
    }
    if (
      !Array.isArray(parsedGroupIds) ||
      !parsedGroupIds.every((value): value is number => Number.isInteger(value) && value > 0) ||
      !Array.isArray(parsedBundleIds) ||
      !parsedBundleIds.every(
        (value): value is string => typeof value === "string" && value.length > 0,
      )
    ) {
      return fail(400, { error: "Invalid selection." });
    }
    const groupIds = [...new Set(parsedGroupIds)];
    const bundleIds = [...new Set(parsedBundleIds)];

    const client = await getClient();
    if (!client) {
      return fail(503, {
        error: "Streaming service is not configured. Contact the administrator.",
      });
    }

    const groupsResult = await listChannelGroups(client);
    if (!groupsResult.ok) {
      return fail(502, { error: groupsResult.message });
    }
    const [settings, catalog] = await Promise.all([
      getLineupPolicySettings(),
      getLineupBundleCatalog(),
    ]);
    const resolution = resolveLineupPolicy({
      user: mapping,
      settings,
      catalog,
      liveGroups: groupsResult.data,
    });
    if (resolution.policy === "fixed") {
      return fail(403, { error: "Your channel selection is managed by the administrator." });
    }

    if (resolution.policy === "approved_selection") {
      const offeredIds = new Set(
        computeOfferedGroups(groupsResult.data, defaults).map((group) => group.id),
      );
      if (!groupIds.every((id) => offeredIds.has(id)) || bundleIds.length > 0) {
        return fail(400, { error: "Invalid selection." });
      }
    } else {
      const enabledBundleIds = new Set(
        catalog.bundles.filter((bundle) => bundle.enabled).map((bundle) => bundle.id),
      );
      if (!bundleIds.every((id) => enabledBundleIds.has(id)) || groupIds.length > 0) {
        return fail(400, { error: "Invalid selection." });
      }
    }

    const result = await enforceLineupPolicySubscription(
      client,
      mapping.id,
      resolution.policy === "approved_selection"
        ? { selectedApprovedGroupIds: groupIds }
        : { selectedBundleIds: bundleIds },
      {
        actor: user.plex_username,
        ipAddress: event.getClientAddress(),
      },
    );
    if (!result.ok) {
      return fail(502, { error: result.message });
    }

    throw redirect(303, "/subscription?saved=1");
  },
};
