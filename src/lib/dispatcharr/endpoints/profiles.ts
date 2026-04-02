import type { DispatcharrClient } from "../client";
import { fetchAllPages } from "../pagination";
import { DispatcharrChannelProfileSchema } from "../schemas";
import type { DispatcharrChannelProfile, DispatcharrResult } from "../types";

export async function listProfiles(
  client: DispatcharrClient,
): Promise<DispatcharrResult<DispatcharrChannelProfile[]>> {
  return fetchAllPages(client, "/api/channels/profiles/", DispatcharrChannelProfileSchema);
}
