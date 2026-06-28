import {
  EMPTY_PROFILE_GROUP_ID,
  getAllGroupProfiles,
} from "$lib/db/repositories/channel-group-profiles";
import { getConfig } from "$lib/db/repositories/config";
import { DispatcharrClient } from "$lib/dispatcharr/client";
import { listPlugins } from "$lib/dispatcharr/endpoints/plugins";
import { describePlugins } from "$lib/dispatcharr/plugins/registry";
import type { DetectedPlugin } from "$lib/dispatcharr/plugins/types";
import { requireAdmin } from "$lib/server/auth";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async (event) => {
  await requireAdmin(event);

  const [url, key] = await Promise.all([
    getConfig("dispatcharr_url"),
    getConfig("dispatcharr_api_key"),
  ]);

  if (!url || !key) {
    return { configured: false, reachable: false, plugins: [] as DetectedPlugin[] };
  }

  // otpravkarr-owned group profile names (exclude the empty-profile sentinel) —
  // used by adapters such as ECM to check scope coverage.
  const ownedProfileNames = getAllGroupProfiles()
    .filter((p) => p.group_id !== EMPTY_PROFILE_GROUP_ID)
    .map((p) => p.profile_name);

  let plugins: DetectedPlugin[] = [];
  let reachable = false;
  try {
    const client = new DispatcharrClient(url, key);
    const result = await listPlugins(client);
    if (result.ok) {
      reachable = true;
      plugins = describePlugins(result.data, ownedProfileNames);
    }
  } catch {
    // Dispatcharr unreachable or plugins API unavailable — show empty state.
  }

  return { configured: true, reachable, plugins };
};
