import type { DispatcharrClient } from "../client";
import { fetchAllPages } from "../pagination";
import { DispatcharrGroupSchema } from "../schemas";
import type { DispatcharrGroup, DispatcharrResult } from "../types";

export async function listGroups(
  client: DispatcharrClient,
): Promise<DispatcharrResult<DispatcharrGroup[]>> {
  try {
    const groups = await fetchAllPages(client, "/api/accounts/groups/", DispatcharrGroupSchema);
    return { ok: true, data: groups };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: "network_error", message };
  }
}
