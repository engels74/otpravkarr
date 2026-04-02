import type { DispatcharrClient } from "../client";
import { fetchAllPages, PaginationError } from "../pagination";
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
    const code = error instanceof PaginationError ? error.code : "network_error";
    return { ok: false, error: code, message };
  }
}
