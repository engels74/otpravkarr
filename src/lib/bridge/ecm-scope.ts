import {
  EMPTY_PROFILE_GROUP_ID,
  getAllGroupProfiles,
} from "$lib/db/repositories/channel-group-profiles";
import type { DispatcharrClient } from "$lib/dispatcharr/client";
import { listPlugins } from "$lib/dispatcharr/endpoints/plugins";
import type { DispatcharrPlugin, DispatcharrResult } from "$lib/dispatcharr/types";
import { isTransientResultError, retryResult } from "$lib/utils/retry";
import { isEcmManagedGroup, profileNameNeedsCsvRepair } from "./group-profiles";

/** Dispatcharr plugin key for Event-Channel-Managarr. */
export const ECM_KEY = "event_channel_managarr";
/** ECM setting holding the comma-separated profile names ECM acts on. */
const ECM_SCOPE_FIELD = "channel_profile_name";

function parseCsv(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function findEcmPlugin(plugins: DispatcharrPlugin[]): DispatcharrPlugin | undefined {
  return plugins.find((plugin) => plugin.key === ECM_KEY);
}

export interface SkippedUnsafeEcmProfile {
  groupId: number;
  profileId: number;
  profileName: string;
  reason: "csv_unsafe";
}

export interface EcmPluginState {
  present: boolean;
  enabled?: boolean;
  settings?: Record<string, unknown>;
}

export interface EcmScopeResult {
  /** ECM's installed, enabled, and settings state as observed from Dispatcharr. */
  plugin: EcmPluginState;
  /** Safe otpravkarr-owned profile names absent from ECM's current CSV scope. */
  missingProfileNames: string[];
  /** Why the analyzer found no actionable safe scope discrepancy. */
  reason?:
    | "no_owned_profiles"
    | "no_safe_owned_profiles"
    | "ecm_absent"
    | "ecm_disabled"
    | "scope_covered";
  /** Stored profile mappings that cannot safely round-trip through ECM's CSV setting. */
  skippedUnsafeProfiles: SkippedUnsafeEcmProfile[];
}

/**
 * Analyze Event-Channel-Managarr's scope without changing Dispatcharr.
 *
 * Lineuparr remains the lineup owner, EPGeditARR remains responsible for virtual
 * and filler EPG, and ECM owns event-channel visibility. Otpravkarr only reports
 * ECM state and scope discrepancies for an operator to resolve.
 */
export async function analyzeEcmScope(
  client: DispatcharrClient,
): Promise<DispatcharrResult<EcmScopeResult>> {
  const skippedUnsafeProfiles: SkippedUnsafeEcmProfile[] = [];
  const ownedProfileNames: string[] = [];

  for (const profile of getAllGroupProfiles()) {
    if (profile.group_id === EMPTY_PROFILE_GROUP_ID) continue;
    if (!isEcmManagedGroup(profile.profile_name)) continue;
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

  const list = await retryResult(() => listPlugins(client), isTransientResultError);
  if (!list.ok) return { ok: false, error: list.error, message: list.message };

  const ecm = findEcmPlugin(list.data);
  if (!ecm) {
    return {
      ok: true,
      data: {
        plugin: { present: false },
        missingProfileNames: ownedProfileNames,
        reason: "ecm_absent",
        skippedUnsafeProfiles,
      },
    };
  }

  const plugin = {
    present: true,
    enabled: ecm.enabled,
    settings: ecm.settings ?? {},
  };
  const scope = new Set(parseCsv(ecm.settings?.[ECM_SCOPE_FIELD]));
  const missingProfileNames = ownedProfileNames.filter((name) => !scope.has(name));

  if (ownedProfileNames.length === 0) {
    return {
      ok: true,
      data: {
        plugin,
        missingProfileNames,
        reason: skippedUnsafeProfiles.length === 0 ? "no_owned_profiles" : "no_safe_owned_profiles",
        skippedUnsafeProfiles,
      },
    };
  }

  if (!ecm.enabled) {
    return {
      ok: true,
      data: {
        plugin,
        missingProfileNames,
        reason: "ecm_disabled",
        skippedUnsafeProfiles,
      },
    };
  }

  return {
    ok: true,
    data: {
      plugin,
      missingProfileNames,
      ...(missingProfileNames.length === 0 ? { reason: "scope_covered" as const } : {}),
      skippedUnsafeProfiles,
    },
  };
}

/**
 * Backwards-compatible bridge entry point for the shared reconcile sequence.
 * Despite the historic name, this is now read-only analysis.
 */
export const reconcileEcmScope = analyzeEcmScope;
