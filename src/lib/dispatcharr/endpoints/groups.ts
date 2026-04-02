import type { DispatcharrClient } from "../client";
import { fetchAllPages } from "../pagination";
import { DispatcharrGroupSchema } from "../schemas";
import type { DispatcharrGroup, DispatcharrResult } from "../types";

export async function listGroups(
  client: DispatcharrClient,
): Promise<DispatcharrResult<DispatcharrGroup[]>> {
  return fetchAllPages(client, "/api/accounts/groups/", DispatcharrGroupSchema);
}
