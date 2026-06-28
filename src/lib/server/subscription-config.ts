import { getConfig } from "$lib/db/repositories/config";
import type { DispatcharrChannelGroup } from "$lib/dispatcharr/types";

/**
 * Server-side resolution of channel-group subscription settings and the
 * "offered groups" computation shared by onboarding, the portal, and admin.
 *
 * Config keys (stored via repositories/config):
 *  - `default_selectable_groups`: JSON array of group IDs offered to users by
 *    default. Empty array / unset = offer ALL (non-quarantine) groups.
 *  - `allow_user_self_select`: "true" | "false". Global default for whether
 *    users may self-select their groups (default: true / allowed).
 */

export const DEFAULT_SELECTABLE_GROUPS_KEY = "default_selectable_groups";
export const ALLOW_USER_SELF_SELECT_KEY = "allow_user_self_select";

/**
 * Quarantine groups created by plugins (IPTV Checker moves dead/slow/black
 * channels here). These are never offered as subscribable. Matched
 * case-insensitively against the group name.
 */
export const QUARANTINE_GROUP_NAMES: readonly string[] = ["Graveyard", "Slow", "Black Screens"];

const quarantineLower = new Set(QUARANTINE_GROUP_NAMES.map((n) => n.toLowerCase()));

export function isQuarantineGroup(name: string): boolean {
  return quarantineLower.has(name.trim().toLowerCase());
}

export interface SubscriptionDefaults {
  /**
   * Group IDs offered by default, or `null` to mean "offer all non-quarantine
   * groups". An explicitly configured empty list is normalized to `null`.
   */
  selectableGroupIds: number[] | null;
  /** Whether users may self-select their groups (global default). */
  allowSelfSelect: boolean;
}

function parseGroupIdList(raw: string | null): number[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const ids = parsed.filter((v): v is number => typeof v === "number" && Number.isInteger(v));
    return ids.length > 0 ? [...new Set(ids)] : null;
  } catch {
    return null;
  }
}

/** Read the subscription default settings (cached config). */
export async function getSubscriptionDefaults(): Promise<SubscriptionDefaults> {
  const [selectableRaw, allowRaw] = await Promise.all([
    getConfig(DEFAULT_SELECTABLE_GROUPS_KEY),
    getConfig(ALLOW_USER_SELF_SELECT_KEY),
  ]);
  return {
    selectableGroupIds: parseGroupIdList(selectableRaw),
    // Default to allowed unless explicitly set to "false".
    allowSelfSelect: allowRaw == null ? true : allowRaw !== "false",
  };
}

/**
 * Compute the groups a user is actually offered, given live Dispatcharr groups
 * and the configured defaults. Always excludes quarantine groups. When
 * `selectableGroupIds` is set, restricts to that set (intersected with live
 * groups); otherwise offers every non-quarantine group.
 */
export function computeOfferedGroups(
  liveGroups: DispatcharrChannelGroup[],
  defaults: SubscriptionDefaults,
): DispatcharrChannelGroup[] {
  const allowed = defaults.selectableGroupIds ? new Set(defaults.selectableGroupIds) : null;
  return liveGroups.filter((g) => {
    if (isQuarantineGroup(g.name)) return false;
    if (allowed && !allowed.has(g.id)) return false;
    return true;
  });
}

/**
 * The default selection a brand-new user starts with: opt-out, i.e. every
 * offered group is pre-selected (so a user is never stranded with zero
 * channels). Returns the offered groups' IDs.
 */
export function defaultSelectedGroupIds(offered: DispatcharrChannelGroup[]): number[] {
  return offered.map((g) => g.id);
}
