import { z } from "zod";

import type { DispatcharrClient } from "../client";
import { fetchAllPages } from "../pagination";
import { DispatcharrChannelSchema, paginatedSchema } from "../schemas";
import type { DispatcharrChannel, DispatcharrResult, PaginatedResponse } from "../types";

const PaginatedChannelsSchema = paginatedSchema(DispatcharrChannelSchema);

/**
 * Fetch every channel (all pages) with the fields needed for subscription
 * scoping: `id`, `effective_channel_group_id` (group membership honoring
 * overrides), and `user_level`. Used by the bridge to bucket channels by group.
 */
export async function listAllChannels(
  client: DispatcharrClient,
): Promise<DispatcharrResult<DispatcharrChannel[]>> {
  return fetchAllPages(client, "/api/channels/channels/", DispatcharrChannelSchema);
}

export function createChannelEndpoints(client: DispatcharrClient) {
  return {
    async listChannels(
      page?: number,
      pageSize?: number,
    ): Promise<DispatcharrResult<PaginatedResponse<DispatcharrChannel>>> {
      const params = new URLSearchParams();
      if (page != null) params.set("page", String(page));
      if (pageSize != null) params.set("page_size", String(pageSize));

      const qs = params.toString();
      const path = `/api/channels/channels/${qs ? `?${qs}` : ""}`;

      return client.request("GET", path, {
        schema: PaginatedChannelsSchema,
      });
    },

    async getAllChannels(): Promise<DispatcharrResult<DispatcharrChannel[]>> {
      return fetchAllPages(client, "/api/channels/channels/", DispatcharrChannelSchema);
    },

    async getChannelStreams(channelId: number): Promise<DispatcharrResult<unknown[]>> {
      return client.request("GET", `/api/channels/channels/${channelId}/streams/`, {
        schema: z.array(z.unknown()),
      });
    },
  };
}
