import { fail, redirect } from "@sveltejs/kit";
import { applyGroupSubscription } from "$lib/bridge/subscriptions";
import { getConfig } from "$lib/db/repositories/config";
import { getUserMappingById } from "$lib/db/repositories/users";
import { DispatcharrClient } from "$lib/dispatcharr/client";
import { listChannelGroups } from "$lib/dispatcharr/endpoints/channel-groups";
import { requireUser } from "$lib/server/auth";
import { computeOfferedGroups, getSubscriptionDefaults } from "$lib/server/subscription-config";
import type { Actions, PageServerLoad } from "./$types";

function parseStoredGroupIds(raw: string): number[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is number => Number.isInteger(v));
  } catch {
    return [];
  }
}

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

  const defaults = await getSubscriptionDefaults();
  // A user may self-select unless globally disabled or individually locked.
  const locked = user.group_selection_locked === 1 || !defaults.allowSelfSelect;

  let offered: { id: number; name: string; channelCount: number | null }[] = [];
  const client = await getClient();
  if (client) {
    const groupsResult = await listChannelGroups(client);
    if (groupsResult.ok) {
      offered = computeOfferedGroups(groupsResult.data, defaults).map((g) => ({
        id: g.id,
        name: g.name,
        channelCount: g.channel_count ?? null,
      }));
    }
  }

  // Current selection, intersected with what's still offered (a group that
  // disappeared or is no longer offered should not appear as selected).
  const offeredIds = new Set(offered.map((g) => g.id));
  const selected = parseStoredGroupIds(user.dispatcharr_group_ids).filter((id) =>
    offeredIds.has(id),
  );

  return {
    plexUsername: user.plex_username,
    offered,
    selected,
    locked,
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

    const raw = String((await event.request.formData()).get("group_ids") ?? "[]");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return fail(400, { error: "Invalid selection." });
    }
    if (!Array.isArray(parsed) || !parsed.every((v): v is number => Number.isInteger(v) && v > 0)) {
      return fail(400, { error: "Invalid selection." });
    }
    const groupIds = [...new Set(parsed as number[])];

    const client = await getClient();
    if (!client) {
      return fail(503, {
        error: "Streaming service is not configured. Contact the administrator.",
      });
    }

    // Re-derive the offered set server-side and reject anything outside it. The
    // intersection in `load` is display-only; the form must not trust the client
    // to post only offered IDs (quarantine groups and admin-excluded groups
    // exist in the live list and would otherwise pass downstream existence-only
    // filtering). Fail closed if the live group list is unavailable.
    const groupsResult = await listChannelGroups(client);
    if (!groupsResult.ok) {
      return fail(502, { error: groupsResult.message });
    }
    const offeredIds = new Set(computeOfferedGroups(groupsResult.data, defaults).map((g) => g.id));
    if (!groupIds.every((id) => offeredIds.has(id))) {
      return fail(400, { error: "Invalid selection." });
    }

    // applyGroupSubscription enforces on Dispatcharr (a zero-group selection
    // resolves to the empty profile — no channels, never the full catalog),
    // persists the selection, and writes the audit entry.
    const result = await applyGroupSubscription(client, mapping.id, groupIds, {
      actor: user.plex_username,
      ipAddress: event.getClientAddress(),
    });
    if (!result.ok) {
      return fail(502, { error: result.message });
    }

    throw redirect(303, "/subscription?saved=1");
  },
};
