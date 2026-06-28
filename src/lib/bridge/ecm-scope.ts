import { appendAuditLog } from "$lib/db/repositories/audit";
import {
  EMPTY_PROFILE_GROUP_ID,
  getAllGroupProfiles,
} from "$lib/db/repositories/channel-group-profiles";
import { AuditAction } from "$lib/db/types";
import type { DispatcharrClient } from "$lib/dispatcharr/client";
import { listPlugins, updatePluginSettings } from "$lib/dispatcharr/endpoints/plugins";
import type { DispatcharrPlugin, DispatcharrResult } from "$lib/dispatcharr/types";
import { isTransientResultError, retryResult } from "$lib/utils/retry";
import { profileNameNeedsCsvRepair } from "./group-profiles";

/**
 * Auto-manage Event-Channel-Managarr's (ECM) scope.
 *
 * ECM toggles event channels (PPV/sports/F1) per Channel Profile, but only for
 * the profiles named in its `channel_profile_name` setting. For event
 * automation to reach a group's subscribers, that group's otpravkarr-owned
 * profile must be in ECM's scope.
 *
 * The plugins admin page only ADVISES which profiles are missing; this module
 * actually writes them into ECM's live settings. It runs in the sync pipeline so
 * profiles created by ordinary subscription activity are folded into ECM scope
 * automatically — no manual step.
 *
 * Write policy is strictly ADDITIVE: existing scope entries (including
 * non-otpravkarr profiles an admin curated, e.g. "Streamers") are preserved and
 * only the missing otpravkarr profiles are appended. We never remove an entry.
 * Because Dispatcharr REPLACES the whole settings object on write, the update is
 * a best-effort guarded read-modify-write. otpravkarr owns only
 * `channel_profile_name`; if a pre-write re-read shows unrelated settings drift,
 * the write is skipped rather than silently clobbering operator edits. This is
 * not an atomic compare-and-swap, but it narrows the race window.
 */

/** Dispatcharr plugin key for Event-Channel-Managarr. */
export const ECM_KEY = "event_channel_managarr";
/** ECM setting holding the comma-separated profile names ECM acts on. */
const ECM_SCOPE_FIELD = "channel_profile_name";

function parseCsv(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function findEcmPlugin(plugins: DispatcharrPlugin[]): DispatcharrPlugin | undefined {
  return plugins.find((p) => p.key === ECM_KEY);
}

function unmanagedSettings(settings: Record<string, unknown> | undefined): Record<string, unknown> {
  const result = { ...(settings ?? {}) };
  delete result[ECM_SCOPE_FIELD];
  return result;
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (typeof value !== "object" || value === null) return value;

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortJsonValue((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

export interface SkippedUnsafeEcmProfile {
  groupId: number;
  profileId: number;
  profileName: string;
  reason: "csv_unsafe";
}

export interface EcmScopeResult {
  /** Whether ECM settings were written this cycle. */
  updated: boolean;
  /** Profile names added to ECM scope (empty when nothing changed). */
  added: string[];
  /** Why no write happened, when `updated` is false. */
  reason?:
    | "no_owned_profiles"
    | "no_safe_owned_profiles"
    | "ecm_absent"
    | "already_in_scope"
    | "settings_drift";
  /** Stored profile mappings skipped because they cannot round-trip via ECM CSV. */
  skippedUnsafeProfiles?: SkippedUnsafeEcmProfile[];
}

/**
 * Ensure every otpravkarr-owned group profile is present in ECM's
 * `channel_profile_name`. Additive read-modify-write; no-op when already
 * covered, ECM is absent, or otpravkarr owns no group profiles yet.
 */
export async function reconcileEcmScope(
  client: DispatcharrClient,
): Promise<DispatcharrResult<EcmScopeResult>> {
  const skippedUnsafeProfiles: SkippedUnsafeEcmProfile[] = [];
  const ownedProfileNames: string[] = [];

  // otpravkarr-owned group profile names. Exclude the empty-profile sentinel,
  // which is never an event-channel target, and skip stale comma-bearing rows:
  // active groups are repaired by reconcileSubscriptions before ECM runs, but
  // stale persisted rows may lack enough live context to repair safely here.
  for (const profile of getAllGroupProfiles()) {
    if (profile.group_id === EMPTY_PROFILE_GROUP_ID) continue;
    if (profileNameNeedsCsvRepair(profile.profile_name)) {
      skippedUnsafeProfiles.push({
        groupId: profile.group_id,
        profileId: profile.profile_id,
        profileName: profile.profile_name,
        reason: "csv_unsafe",
      });
      continue;
    }
    ownedProfileNames.push(profile.profile_name);
  }

  if (ownedProfileNames.length === 0) {
    return {
      ok: true,
      data: {
        updated: false,
        added: [],
        reason: skippedUnsafeProfiles.length === 0 ? "no_owned_profiles" : "no_safe_owned_profiles",
        skippedUnsafeProfiles,
      },
    };
  }

  const list = await retryResult(() => listPlugins(client), isTransientResultError);
  if (!list.ok) return { ok: false, error: list.error, message: list.message };

  const ecm = findEcmPlugin(list.data);
  if (!ecm) {
    return {
      ok: true,
      data: { updated: false, added: [], reason: "ecm_absent", skippedUnsafeProfiles },
    };
  }

  const currentScope = parseCsv(ecm.settings?.[ECM_SCOPE_FIELD]);
  const scopeSet = new Set(currentScope);
  const missing = ownedProfileNames.filter((name) => !scopeSet.has(name));
  if (missing.length === 0) {
    return {
      ok: true,
      data: { updated: false, added: [], reason: "already_in_scope", skippedUnsafeProfiles },
    };
  }

  const latestList = await retryResult(() => listPlugins(client), isTransientResultError);
  if (!latestList.ok) {
    return { ok: false, error: latestList.error, message: latestList.message };
  }

  const latestEcm = findEcmPlugin(latestList.data);
  if (!latestEcm) {
    return {
      ok: true,
      data: { updated: false, added: [], reason: "ecm_absent", skippedUnsafeProfiles },
    };
  }

  if (
    stableStringify(unmanagedSettings(ecm.settings)) !==
    stableStringify(unmanagedSettings(latestEcm.settings))
  ) {
    return {
      ok: true,
      data: { updated: false, added: [], reason: "settings_drift", skippedUnsafeProfiles },
    };
  }

  const latestScope = parseCsv(latestEcm.settings?.[ECM_SCOPE_FIELD]);
  const latestScopeSet = new Set(latestScope);
  const latestMissing = ownedProfileNames.filter((name) => !latestScopeSet.has(name));
  if (latestMissing.length === 0) {
    return {
      ok: true,
      data: { updated: false, added: [], reason: "already_in_scope", skippedUnsafeProfiles },
    };
  }

  // Preserve existing entries (order + non-otpravkarr profiles), append missing.
  const newScope = [...latestScope, ...latestMissing];
  const mergedSettings: Record<string, unknown> = {
    ...(latestEcm.settings ?? {}),
    [ECM_SCOPE_FIELD]: newScope.join(", "),
  };

  const write = await updatePluginSettings(client, ECM_KEY, mergedSettings);
  if (!write.ok) return { ok: false, error: write.error, message: write.message };

  // Auditable because this mutates a live external plugin's configuration.
  try {
    appendAuditLog({
      action: AuditAction.ECM_SCOPE_UPDATED,
      detail: { added: latestMissing, scope: newScope, skippedUnsafeProfiles },
    });
  } catch {
    // Audit write is best-effort; the ECM scope write already succeeded.
  }

  return { ok: true, data: { updated: true, added: latestMissing, skippedUnsafeProfiles } };
}
