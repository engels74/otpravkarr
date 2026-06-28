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
 *
 * These names are the BUILT-IN DEFAULTS. They are the IPTV Checker plugin's
 * own factory defaults (`move_to_group_name`/`move_low_framerate_group`/
 * `move_black_screen_group`), but the plugin lets admins rename them. The live
 * names are reconciled from the plugin each sync cycle and unioned with these
 * defaults (see bridge/quarantine-sync.ts), so a plugin rename can never
 * silently leak quarantine channels into the offered list. The plugin-derived
 * portion can be replaced after successful reads, but the defaults remain a
 * permanent floor even if the plugin is unreachable.
 */
export const QUARANTINE_GROUP_NAMES: readonly string[] = ["Graveyard", "Slow", "Black Screens"];

export type QuarantineGroupStateSource = "defaults" | "legacy" | "plugin";

export interface QuarantineGroupState {
  version: 1;
  defaultNames: string[];
  pluginNames: string[];
  resolvedNames: string[];
  source: QuarantineGroupStateSource;
  refreshedAt: string | null;
}

export interface SetQuarantineGroupNamesOptions {
  source?: QuarantineGroupStateSource;
  refreshedAt?: string | null;
}

/**
 * Live quarantine-name lookup (lowercased). Seeded with the built-in defaults;
 * successful plugin reads replace the plugin-derived portion while always
 * retaining those defaults. Mutable module state is acceptable here: it is a
 * single-process advisory cache that converges via the sync job and is hydrated
 * from config at startup.
 */
let quarantineLower = new Set(QUARANTINE_GROUP_NAMES.map((n) => n.toLowerCase()));
/** Resolved quarantine names in original case (defaults ∪ plugin-configured). */
let quarantineNames: string[] = [...QUARANTINE_GROUP_NAMES];
/** Source-aware state behind the runtime matcher. */
let quarantineState: QuarantineGroupState = {
  version: 1,
  defaultNames: [...QUARANTINE_GROUP_NAMES],
  pluginNames: [],
  resolvedNames: [...QUARANTINE_GROUP_NAMES],
  source: "defaults",
  refreshedAt: null,
};

function normalizeNames(names: Iterable<string>): string[] {
  const byLower = new Map<string, string>();
  for (const raw of names) {
    const trimmed = raw.trim();
    if (trimmed === "") continue;
    const lower = trimmed.toLowerCase();
    if (!byLower.has(lower)) byLower.set(lower, trimmed);
  }
  return [...byLower.values()];
}

function withoutBuiltInDefaults(names: Iterable<string>): string[] {
  const defaultLower = new Set(QUARANTINE_GROUP_NAMES.map((name) => name.toLowerCase()));
  return normalizeNames(names).filter((name) => !defaultLower.has(name.toLowerCase()));
}

function buildQuarantineState(
  pluginNames: Iterable<string>,
  options: SetQuarantineGroupNamesOptions = {},
): QuarantineGroupState {
  const normalizedPluginNames = normalizeNames(pluginNames);
  const resolvedNames = normalizeNames([...QUARANTINE_GROUP_NAMES, ...normalizedPluginNames]);
  return {
    version: 1,
    defaultNames: [...QUARANTINE_GROUP_NAMES],
    pluginNames: normalizedPluginNames,
    resolvedNames,
    source:
      options.source ??
      (normalizedPluginNames.length === 0 ? ("defaults" as const) : ("plugin" as const)),
    refreshedAt: options.refreshedAt ?? null,
  };
}

function lenientStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === "string");
}

function strictStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  return value;
}

function isStateSource(value: unknown): value is QuarantineGroupStateSource {
  return value === "defaults" || value === "legacy" || value === "plugin";
}

export function isQuarantineGroup(name: string): boolean {
  return quarantineLower.has(name.trim().toLowerCase());
}

/**
 * The quarantine names currently in effect (built-in defaults unioned with any
 * resolved from the live plugin). Original case; deduplicated case-insensitively.
 */
export function getQuarantineGroupNames(): string[] {
  return [...quarantineNames];
}

/** Source-aware quarantine state for logs/tests/future read-only UI. */
export function getQuarantineGroupState(): QuarantineGroupState {
  return {
    version: 1,
    defaultNames: [...quarantineState.defaultNames],
    pluginNames: [...quarantineState.pluginNames],
    resolvedNames: [...quarantineState.resolvedNames],
    source: quarantineState.source,
    refreshedAt: quarantineState.refreshedAt,
  };
}

/**
 * Replace the plugin-derived quarantine set. The built-in defaults are ALWAYS
 * unioned in, so the matcher never drops a factory junk-group name (e.g. a
 * transient empty/garbage plugin read can't expose "Graveyard"). Names are
 * trimmed, empty entries dropped, and deduplicated case-insensitively.
 */
export function setQuarantineGroupNames(
  names: Iterable<string>,
  options: SetQuarantineGroupNamesOptions = {},
): void {
  quarantineState = buildQuarantineState(names, options);
  quarantineNames = [...quarantineState.resolvedNames];
  quarantineLower = new Set(quarantineNames.map((name) => name.toLowerCase()));
}

/**
 * Apply persisted quarantine state. Accepts the legacy flat resolved-name array
 * and the structured v1 object. Returns false for malformed payloads.
 */
export function applyPersistedQuarantineGroupState(parsed: unknown): boolean {
  if (Array.isArray(parsed)) {
    const legacyNames = lenientStringArray(parsed);
    if (!legacyNames) return false;
    setQuarantineGroupNames(withoutBuiltInDefaults(legacyNames), {
      source: "legacy",
      refreshedAt: null,
    });
    return true;
  }

  if (typeof parsed !== "object" || parsed === null) return false;

  const payload = parsed as Record<string, unknown>;
  if (payload.version !== 1) return false;

  // `resolvedNames` is intentionally not consulted: hydration rebuilds the
  // resolved set from `pluginNames` unioned with the built-in defaults (via
  // setQuarantineGroupNames → buildQuarantineState), so valid `pluginNames`
  // alone is sufficient to restore the matcher. Gating on a persisted
  // `resolvedNames` would silently fall back to defaults for partial payloads.
  const pluginNames = strictStringArray(payload.pluginNames);
  if (!pluginNames) return false;

  setQuarantineGroupNames(pluginNames, {
    source: isStateSource(payload.source) ? payload.source : "plugin",
    refreshedAt: typeof payload.refreshedAt === "string" ? payload.refreshedAt : null,
  });
  return true;
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
