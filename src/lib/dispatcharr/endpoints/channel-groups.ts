import type { DispatcharrClient } from "../client";
import { fetchAllPages } from "../pagination";
import { DispatcharrChannelGroupSchema } from "../schemas";
import type { DispatcharrChannelGroup, DispatcharrResult } from "../types";

/**
 * List Dispatcharr CHANNEL groups (`/api/channels/groups/`).
 *
 * These organize channels and are the unit users subscribe to. They are NOT
 * the Django permission groups served by `/api/accounts/groups/` (see
 * endpoints/groups.ts). The endpoint returns a flat array; fetchAllPages
 * tolerates both flat and paginated shapes.
 */
export async function listChannelGroups(
  client: DispatcharrClient,
): Promise<DispatcharrResult<DispatcharrChannelGroup[]>> {
  return fetchAllPages(client, "/api/channels/groups/", DispatcharrChannelGroupSchema);
}
