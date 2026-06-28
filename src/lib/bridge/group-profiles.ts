import {
  EMPTY_PROFILE_GROUP_ID,
  getGroupProfile,
  upsertGroupProfile,
} from "$lib/db/repositories/channel-group-profiles";
import type { DispatcharrClient } from "$lib/dispatcharr/client";
import {
  bulkUpdateProfileMembership,
  createProfile,
  getProfile,
  listProfiles,
  type ProfileMembershipUpdate,
} from "$lib/dispatcharr/endpoints/profiles";
import type {
  DispatcharrChannel,
  DispatcharrChannelProfileWithChannels,
  DispatcharrResult,
} from "$lib/dispatcharr/types";
import { isTransientResultError, retryResult } from "$lib/utils/retry";

/**
 * Model A machinery: maintain one otpravkarr-owned Channel Profile per
 * subscribable channel group, scoped to exactly that group's channels, plus a
 * shared "empty" profile (zero enabled channels) for zero-group subscriptions.
 *
 * These profiles are the coordination plane otpravkarr owns. A user's
 * subscription is expressed as `user.channel_profiles = [profile per group]`,
 * and Dispatcharr resolves the UNION (verified against apps/output/views.py).
 *
 * IMPORTANT: a freshly created Dispatcharr profile starts with EVERY channel
 * enabled (server-side post_save signal). Scoping therefore means disabling all
 * non-group channels — handled here via a diff-and-patch against the profile's
 * current enabled membership.
 */

/** Prefix for every otpravkarr-managed channel profile name. */
export const OTPRAVKARR_PROFILE_PREFIX = "otpravkarr:";
/** Name of the shared empty profile (zero enabled channels). */
export const EMPTY_PROFILE_NAME = `${OTPRAVKARR_PROFILE_PREFIX}empty`;
/** Dispatcharr CharField(max_length=100) for ChannelProfile.name. */
const PROFILE_NAME_MAX_LENGTH = 100;

/**
 * Bucket channels by their effective channel group id (honoring overrides).
 * Channels with no group are skipped (not subscribable through a group).
 */
export function buildGroupChannelMap(channels: DispatcharrChannel[]): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (const channel of channels) {
    const groupId = channel.effective_channel_group_id ?? channel.channel_group_id;
    if (groupId == null) continue;
    const bucket = map.get(groupId);
    if (bucket) {
      bucket.push(channel.id);
    } else {
      map.set(groupId, [channel.id]);
    }
  }
  return map;
}

/**
 * Build a stable, readable, unique profile name for a group. The group id keeps
 * the name unique and stable across renames (Channel Mapparr renames groups);
 * the human name is appended for admin/ECM readability and truncated to fit.
 */
export function profileNameForGroup(groupId: number, groupName: string): string {
  const base = `${OTPRAVKARR_PROFILE_PREFIX}g${groupId}:`;
  const remaining = PROFILE_NAME_MAX_LENGTH - base.length;
  const cleaned = groupName.replace(/\s+/g, " ").trim();
  return `${base}${cleaned.slice(0, Math.max(0, remaining))}`;
}

/**
 * Create a profile by name, or adopt an existing one with the same name. The
 * adopt path covers a reset local DB whose Dispatcharr profiles survived
 * (otherwise the unique-name constraint would hard-fail provisioning).
 */
async function adoptOrCreateProfile(
  client: DispatcharrClient,
  name: string,
): Promise<DispatcharrResult<DispatcharrChannelProfileWithChannels>> {
  const created = await retryResult(() => createProfile(client, name), isTransientResultError);
  if (created.ok) return created;
  // A name collision surfaces as a 400 validation error.
  if (created.error === "validation_error") {
    const list = await retryResult(() => listProfiles(client), isTransientResultError);
    if (list.ok) {
      const match = list.data.find((p) => p.name === name);
      if (match) {
        return retryResult(() => getProfile(client, match.id), isTransientResultError);
      }
    }
  }
  return created;
}

/**
 * Reconcile a profile's enabled membership toward `desiredEnabled`, patching
 * only the difference. No-op when already aligned.
 */
async function applyMembershipDiff(
  client: DispatcharrClient,
  profileId: number,
  desiredEnabled: Set<number>,
  currentEnabled: Set<number>,
): Promise<DispatcharrResult<unknown>> {
  const updates: ProfileMembershipUpdate[] = [];
  for (const id of desiredEnabled) {
    if (!currentEnabled.has(id)) updates.push({ channel_id: id, enabled: true });
  }
  for (const id of currentEnabled) {
    if (!desiredEnabled.has(id)) updates.push({ channel_id: id, enabled: false });
  }
  if (updates.length === 0) return { ok: true, data: null };
  return retryResult(
    () => bulkUpdateProfileMembership(client, profileId, updates),
    isTransientResultError,
  );
}

/**
 * Ensure the otpravkarr-owned profile for `groupId` exists and contains exactly
 * `desiredEnabled` (the group's current channels). Creates/adopts the profile
 * if missing and records the group→profile mapping locally. Returns the
 * profile id on success.
 */
export async function reconcileGroupProfile(
  client: DispatcharrClient,
  groupId: number,
  groupName: string,
  desiredEnabled: Set<number>,
): Promise<DispatcharrResult<number>> {
  let profileId: number;
  let currentEnabled: Set<number>;

  const existing = getGroupProfile(groupId);
  if (existing) {
    const got = await retryResult(
      () => getProfile(client, existing.profile_id),
      isTransientResultError,
    );
    if (got.ok) {
      profileId = got.data.id;
      currentEnabled = new Set(got.data.channels);
    } else if (got.error === "not_found") {
      const created = await adoptOrCreateProfile(client, profileNameForGroup(groupId, groupName));
      if (!created.ok) return created;
      upsertGroupProfile(groupId, created.data.id, created.data.name);
      profileId = created.data.id;
      currentEnabled = new Set(created.data.channels);
    } else {
      return { ok: false, error: got.error, message: got.message };
    }
  } else {
    const created = await adoptOrCreateProfile(client, profileNameForGroup(groupId, groupName));
    if (!created.ok) return created;
    upsertGroupProfile(groupId, created.data.id, created.data.name);
    profileId = created.data.id;
    currentEnabled = new Set(created.data.channels);
  }

  const diff = await applyMembershipDiff(client, profileId, desiredEnabled, currentEnabled);
  if (!diff.ok) return { ok: false, error: diff.error, message: diff.message };

  return { ok: true, data: profileId };
}

/**
 * Ensure the shared empty profile exists with ZERO enabled channels. Used to
 * represent a zero-group subscription safely — assigning an empty
 * `channel_profiles` array would instead expose the entire catalog (brief 3.5).
 * Returns the empty profile id.
 */
export async function ensureEmptyProfile(
  client: DispatcharrClient,
): Promise<DispatcharrResult<number>> {
  const existing = getGroupProfile(EMPTY_PROFILE_GROUP_ID);
  if (existing) {
    const got = await retryResult(
      () => getProfile(client, existing.profile_id),
      isTransientResultError,
    );
    if (got.ok) {
      const diff = await applyMembershipDiff(
        client,
        got.data.id,
        new Set(),
        new Set(got.data.channels),
      );
      if (!diff.ok) return { ok: false, error: diff.error, message: diff.message };
      return { ok: true, data: got.data.id };
    }
    if (got.error !== "not_found") {
      return { ok: false, error: got.error, message: got.message };
    }
    // Fall through and recreate.
  }

  const created = await adoptOrCreateProfile(client, EMPTY_PROFILE_NAME);
  if (!created.ok) return { ok: false, error: created.error, message: created.message };
  upsertGroupProfile(EMPTY_PROFILE_GROUP_ID, created.data.id, created.data.name);
  const diff = await applyMembershipDiff(
    client,
    created.data.id,
    new Set(),
    new Set(created.data.channels),
  );
  if (!diff.ok) return { ok: false, error: diff.error, message: diff.message };
  return { ok: true, data: created.data.id };
}
