import {
  EMPTY_PROFILE_GROUP_ID,
  getGroupProfile,
  updateGroupProfileKnownChannels,
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
  // Strip commas before collapsing whitespace: ECM's `channel_profile_name` is a
  // comma-separated list (see bridge/ecm-scope.ts), so a comma embedded in the
  // group name would make the profile name un-round-trippable — split into two
  // bogus entries on read-back, seen as perpetually "missing", and re-appended
  // every sync. Profile names are otpravkarr's own namespace, so normalizing the
  // delimiter out of them here is safe and self-contained.
  const cleaned = groupName.replace(/,/g, " ").replace(/\s+/g, " ").trim();
  return `${base}${cleaned.slice(0, Math.max(0, remaining))}`;
}

/** Whether an existing otpravkarr profile name is unsafe for ECM's CSV scope. */
export function profileNameNeedsCsvRepair(name: string): boolean {
  return name.includes(",");
}

/** Event groups whose profile visibility is owned by Event Channel Managarr. */
export function isEcmManagedGroup(groupName: string): boolean {
  return groupName.endsWith(" — PPV/Events") || groupName.endsWith(" — Unscheduled Events");
}

function parseKnownChannelIds(value: string | undefined): Set<number> {
  if (!value) return new Set();
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter(
        (id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0,
      ),
    );
  } catch {
    return new Set();
  }
}

function updateKnownChannelsSafe(
  groupId: number,
  channelIds: Set<number>,
): DispatcharrResult<void> {
  try {
    updateGroupProfileKnownChannels(groupId, [...channelIds]);
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: "server_error",
      message: `Failed to persist known channels for group ${groupId}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Create a profile by name, or adopt an existing one. The adopt path covers a
 * reset local DB whose Dispatcharr profiles survived (otherwise the unique-name
 * constraint would hard-fail provisioning).
 *
 * When `adoptPrefix` is given (group profiles), scan for an existing owned
 * profile by the rename-stable `otpravkarr:g{groupId}:` prefix BEFORE creating.
 * A group renamed since the last sync still carries the prefix under its old
 * display name, so an exact-name match would miss it and `createProfile` would
 * succeed — silently orphaning the old profile behind a second prefix-matching
 * one. A list failure other than `not_found` is surfaced rather than blindly
 * creating a duplicate. Callers without a prefix (the constant-named empty
 * profile) keep the exact-name collision fallback below.
 */
async function adoptOrCreateProfile(
  client: DispatcharrClient,
  name: string,
  adoptPrefix?: string,
): Promise<DispatcharrResult<DispatcharrChannelProfileWithChannels>> {
  if (adoptPrefix !== undefined) {
    const list = await retryResult(() => listProfiles(client), isTransientResultError);
    if (!list.ok && list.error !== "not_found") {
      return { ok: false, error: list.error, message: list.message };
    }
    if (list.ok) {
      const match = list.data.find(
        (p) => p.name.startsWith(adoptPrefix) && !profileNameNeedsCsvRepair(p.name),
      );
      if (match) {
        return retryResult(() => getProfile(client, match.id), isTransientResultError);
      }
    }
  }

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
 * Persist a group→profile mapping, converting a thrown DB error (constraint/IO)
 * into a structured failure. The local `upsertGroupProfile` runs a raw
 * `bun:sqlite` statement that throws, so wrapping it here keeps callers within
 * this module's no-throw `DispatcharrResult` contract instead of crashing them.
 */
function upsertGroupProfileSafe(
  groupId: number,
  profileId: number,
  profileName: string,
): DispatcharrResult<void> {
  try {
    upsertGroupProfile(groupId, profileId, profileName);
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: "server_error",
      message: `Failed to persist group ${groupId} → profile ${profileId} mapping: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
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

  const expectedName = profileNameForGroup(groupId, groupName);
  // Ownership is keyed on the rename-stable `otpravkarr:g{groupId}:` prefix, not
  // the full name: the human group name is mutable (Channel Mapparr renames
  // groups), so a prefix match lets us reconcile our profile in place across
  // renames instead of orphaning it and recreating a new one every rename. The
  // groupId in the prefix is unique, so a foreign profile that merely reused
  // this numeric id won't carry it.
  const ownedPrefix = `${OTPRAVKARR_PROFILE_PREFIX}g${groupId}:`;
  const existing = getGroupProfile(groupId);
  if (existing) {
    const got = await retryResult(
      () => getProfile(client, existing.profile_id),
      isTransientResultError,
    );
    if (got.ok && got.data.name.startsWith(ownedPrefix)) {
      if (profileNameNeedsCsvRepair(got.data.name)) {
        // Legacy profile names may contain commas from before profileNameForGroup
        // normalized them. ECM stores scope as CSV, so keep the old comma-bearing
        // remote profile untouched and move the local mapping onto a comma-free
        // one. Passing ownedPrefix reuses an existing comma-free prefix-owned
        // profile if one already exists (the scan filters comma-bearing names
        // out, so the unsafe match is still skipped) — without it a comma-free
        // profile under a different suffix, e.g. after a rename, would be
        // orphaned and a duplicate created.
        const repaired = await adoptOrCreateProfile(client, expectedName, ownedPrefix);
        if (!repaired.ok) return repaired;
        const saved = upsertGroupProfileSafe(groupId, repaired.data.id, repaired.data.name);
        if (!saved.ok) return saved;
        profileId = repaired.data.id;
        currentEnabled = new Set(repaired.data.channels);
      } else {
        if (
          profileNameNeedsCsvRepair(existing.profile_name) &&
          existing.profile_name !== got.data.name
        ) {
          const saved = upsertGroupProfileSafe(groupId, got.data.id, got.data.name);
          if (!saved.ok) return saved;
        }
        profileId = got.data.id;
        currentEnabled = new Set(got.data.channels);
      }
    } else if (got.ok || got.error === "not_found") {
      // Stale mapping: the profile was deleted (404) or its numeric id was
      // reused by an unrelated profile (name lacks our prefix). Re-adopt/create
      // the owned profile under the current name and correct the local mapping
      // rather than mutating a foreign profile.
      const created = await adoptOrCreateProfile(client, expectedName, ownedPrefix);
      if (!created.ok) return created;
      const saved = upsertGroupProfileSafe(groupId, created.data.id, created.data.name);
      if (!saved.ok) return saved;
      profileId = created.data.id;
      currentEnabled = new Set(created.data.channels);
    } else {
      return { ok: false, error: got.error, message: got.message };
    }
  } else {
    const created = await adoptOrCreateProfile(client, expectedName, ownedPrefix);
    if (!created.ok) return created;
    const saved = upsertGroupProfileSafe(groupId, created.data.id, created.data.name);
    if (!saved.ok) return saved;
    profileId = created.data.id;
    currentEnabled = new Set(created.data.channels);
  }

  let effectiveDesired = desiredEnabled;
  if (isEcmManagedGroup(groupName) && existing) {
    const previouslyKnown = parseKnownChannelIds(existing.known_channel_ids);
    const hiddenByEcm = new Set([...previouslyKnown].filter((id) => !currentEnabled.has(id)));
    effectiveDesired = new Set([...desiredEnabled].filter((id) => !hiddenByEcm.has(id)));
  }

  const diff = await applyMembershipDiff(client, profileId, effectiveDesired, currentEnabled);
  if (!diff.ok) return { ok: false, error: diff.error, message: diff.message };

  const savedKnown = updateKnownChannelsSafe(groupId, desiredEnabled);
  if (!savedKnown.ok) return savedKnown;

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
    if (got.ok && got.data.name === EMPTY_PROFILE_NAME) {
      const diff = await applyMembershipDiff(
        client,
        got.data.id,
        new Set(),
        new Set(got.data.channels),
      );
      if (!diff.ok) return { ok: false, error: diff.error, message: diff.message };
      return { ok: true, data: got.data.id };
    }
    if (!got.ok && got.error !== "not_found") {
      return { ok: false, error: got.error, message: got.message };
    }
    // Stale mapping: the profile was deleted (404) or its numeric id was reused
    // by an unrelated profile (name mismatch). Fall through and re-adopt/create
    // the empty profile by name rather than disabling channels on a foreign one.
  }

  const created = await adoptOrCreateProfile(client, EMPTY_PROFILE_NAME);
  if (!created.ok) return { ok: false, error: created.error, message: created.message };
  const saved = upsertGroupProfileSafe(EMPTY_PROFILE_GROUP_ID, created.data.id, created.data.name);
  if (!saved.ok) return saved;
  const diff = await applyMembershipDiff(
    client,
    created.data.id,
    new Set(),
    new Set(created.data.channels),
  );
  if (!diff.ok) return { ok: false, error: diff.error, message: diff.message };
  return { ok: true, data: created.data.id };
}
