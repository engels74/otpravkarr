import { appendAuditLog } from "$lib/db/repositories/audit";
import {
  EMPTY_PROFILE_GROUP_ID,
  getAllGroupProfiles,
} from "$lib/db/repositories/channel-group-profiles";
import { AuditAction } from "$lib/db/types";
import type { DispatcharrClient } from "$lib/dispatcharr/client";
import { listPlugins, updatePluginSettings } from "$lib/dispatcharr/endpoints/plugins";
import type { DispatcharrResult } from "$lib/dispatcharr/types";
import { isTransientResultError, retryResult } from "$lib/utils/retry";

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
 * a read-modify-write that carries every other ECM setting through untouched.
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

export interface EcmScopeResult {
  /** Whether ECM settings were written this cycle. */
  updated: boolean;
  /** Profile names added to ECM scope (empty when nothing changed). */
  added: string[];
  /** Why no write happened, when `updated` is false. */
  reason?: "no_owned_profiles" | "ecm_absent" | "already_in_scope";
}

/**
 * Ensure every otpravkarr-owned group profile is present in ECM's
 * `channel_profile_name`. Additive read-modify-write; no-op when already
 * covered, ECM is absent, or otpravkarr owns no group profiles yet.
 */
export async function reconcileEcmScope(
  client: DispatcharrClient,
): Promise<DispatcharrResult<EcmScopeResult>> {
  // otpravkarr-owned group profile names (exclude the empty-profile sentinel,
  // which is never an event-channel target).
  const ownedProfileNames = getAllGroupProfiles()
    .filter((p) => p.group_id !== EMPTY_PROFILE_GROUP_ID)
    .map((p) => p.profile_name);

  if (ownedProfileNames.length === 0) {
    return { ok: true, data: { updated: false, added: [], reason: "no_owned_profiles" } };
  }

  const list = await retryResult(() => listPlugins(client), isTransientResultError);
  if (!list.ok) return { ok: false, error: list.error, message: list.message };

  const ecm = list.data.find((p) => p.key === ECM_KEY);
  if (!ecm) {
    return { ok: true, data: { updated: false, added: [], reason: "ecm_absent" } };
  }

  const currentScope = parseCsv(ecm.settings?.[ECM_SCOPE_FIELD]);
  const scopeSet = new Set(currentScope);
  const missing = ownedProfileNames.filter((name) => !scopeSet.has(name));
  if (missing.length === 0) {
    return { ok: true, data: { updated: false, added: [], reason: "already_in_scope" } };
  }

  // Preserve existing entries (order + non-otpravkarr profiles), append missing.
  const newScope = [...currentScope, ...missing];
  const mergedSettings: Record<string, unknown> = {
    ...(ecm.settings ?? {}),
    [ECM_SCOPE_FIELD]: newScope.join(", "),
  };

  const write = await updatePluginSettings(client, ECM_KEY, mergedSettings);
  if (!write.ok) return { ok: false, error: write.error, message: write.message };

  // Auditable because this mutates a live external plugin's configuration.
  try {
    appendAuditLog({
      action: AuditAction.ECM_SCOPE_UPDATED,
      detail: { added: missing, scope: newScope },
    });
  } catch {
    // Audit write is best-effort; the ECM scope write already succeeded.
  }

  return { ok: true, data: { updated: true, added: missing } };
}
