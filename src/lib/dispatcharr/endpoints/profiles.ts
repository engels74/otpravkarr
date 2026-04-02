import type { DispatcharrClient } from "../client";
import { fetchAllPages, PaginationError } from "../pagination";
import { DispatcharrChannelProfileSchema } from "../schemas";
import type { DispatcharrChannelProfile, DispatcharrResult } from "../types";

export async function listProfiles(
  client: DispatcharrClient,
): Promise<DispatcharrResult<DispatcharrChannelProfile[]>> {
  try {
    const profiles = await fetchAllPages(
      client,
      "/api/channels/profiles/",
      DispatcharrChannelProfileSchema,
    );
    return { ok: true, data: profiles };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof PaginationError ? error.code : "network_error";
    return { ok: false, error: code, message };
  }
}
