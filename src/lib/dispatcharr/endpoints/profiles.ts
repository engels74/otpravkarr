import type { DispatcharrClient } from "../client";
import { fetchAllPages } from "../pagination";
import {
  DispatcharrChannelProfileSchema,
  DispatcharrChannelProfileWithChannelsSchema,
} from "../schemas";
import type {
  DispatcharrChannelProfile,
  DispatcharrChannelProfileWithChannels,
  DispatcharrResult,
} from "../types";

/** List all channel profiles (id + name). */
export async function listProfiles(
  client: DispatcharrClient,
): Promise<DispatcharrResult<DispatcharrChannelProfile[]>> {
  return fetchAllPages(client, "/api/channels/profiles/", DispatcharrChannelProfileSchema);
}

/**
 * Fetch a single channel profile including its enabled-channel membership
 * (array of channel IDs). Used to diff current vs. desired membership.
 */
export function getProfile(
  client: DispatcharrClient,
  id: number,
): Promise<DispatcharrResult<DispatcharrChannelProfileWithChannels>> {
  return client.request("GET", `/api/channels/profiles/${id}/`, {
    schema: DispatcharrChannelProfileWithChannelsSchema,
  });
}

/**
 * Create a new channel profile by name.
 *
 * NOTE: Dispatcharr auto-populates a fresh profile with a membership row for
 * EVERY channel, enabled by default (server-side post_save signal). A freshly
 * created profile therefore exposes the entire catalog until its membership is
 * scoped via bulkUpdateProfileMembership. Callers MUST scope it before
 * assigning it to a non-admin user (see bridge/subscriptions.ts).
 */
export function createProfile(
  client: DispatcharrClient,
  name: string,
): Promise<DispatcharrResult<DispatcharrChannelProfileWithChannels>> {
  return client.request("POST", "/api/channels/profiles/", {
    body: { name },
    schema: DispatcharrChannelProfileWithChannelsSchema,
  });
}

export interface ProfileMembershipUpdate {
  channel_id: number;
  enabled: boolean;
}

/**
 * Bulk enable/disable channels for a profile
 * (`PATCH /api/channels/profiles/{id}/channels/bulk-update/`).
 *
 * Upsert semantics: listed channels are updated (or their membership created);
 * unlisted channels keep their current state. The response body is not
 * consumed. Sending an empty list is a no-op the caller should skip.
 */
export function bulkUpdateProfileMembership(
  client: DispatcharrClient,
  profileId: number,
  channels: ProfileMembershipUpdate[],
): Promise<DispatcharrResult<unknown>> {
  return client.request("PATCH", `/api/channels/profiles/${profileId}/channels/bulk-update/`, {
    body: { channels },
  });
}
