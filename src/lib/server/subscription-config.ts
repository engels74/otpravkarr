import { getConfig } from "$lib/db/repositories/config";
import type { LineupBundle, LineupPolicy, UserMapping } from "$lib/db/types";
import type { DispatcharrChannelGroup } from "$lib/dispatcharr/types";

/**
 * Server-side resolution of channel-group subscription settings and the
 * "offered groups" computation shared by onboarding, the portal, and admin.
 *
 * Config keys (stored via repositories/config):
 *  - `default_selectable_groups`: JSON array of admin-approved group IDs.
 *    Empty, malformed, or unset fails closed to no approved groups.
 *  - `allow_user_self_select`: "true" | "false". Global default for whether
 *    users may self-select their groups (default: true / allowed).
 */

export const DEFAULT_SELECTABLE_GROUPS_KEY = "default_selectable_groups";
export const ALLOW_USER_SELF_SELECT_KEY = "allow_user_self_select";
export const LINEUP_POLICY_DEFAULT_KEY = "lineup_policy_default";
export const LINEUP_FIXED_GROUP_IDS_KEY = "lineup_fixed_group_ids";
export const LINEUP_CORE_GROUP_IDS_KEY = "lineup_core_group_ids";
export const LINEUP_BUNDLE_CATALOG_VERSION_KEY = "lineup_bundle_catalog_version";

export interface ResolvedLineupBundle {
  id: string;
  slug: string;
  displayName: string;
  enabled: boolean;
  groupIds: number[];
}

export interface LineupBundleCatalog {
  version: number;
  bundles: ResolvedLineupBundle[];
}

export interface LineupPolicySettings {
  defaultPolicy: LineupPolicy;
  fixedGroupIds: number[];
  coreGroupIds: number[];
  /** `null` means unset or malformed, which fails closed. */
  approvedGroupIds: number[] | null;
  bundleCatalogVersion: number | null;
}

export interface LineupResolutionInput {
  user: Pick<
    UserMapping,
    "lineup_policy_override" | "selected_bundle_ids" | "selected_approved_group_ids"
  >;
  settings: Pick<
    LineupPolicySettings,
    "defaultPolicy" | "fixedGroupIds" | "coreGroupIds" | "approvedGroupIds"
  >;
  catalog: Pick<LineupBundleCatalog, "bundles">;
  liveGroups: DispatcharrChannelGroup[];
}

export interface LineupResolution {
  policy: LineupPolicy;
  /** Materialized IDs safe to send to Dispatcharr, sorted and deduplicated. */
  effectiveGroupIds: number[];
  /** Unchanged parsed intent, including IDs absent from the current live catalog. */
  selectedBundleIds: string[];
  /** Unchanged parsed intent, including unapproved or missing IDs. */
  selectedApprovedGroupIds: number[];
}

function isLineupPolicy(value: unknown): value is LineupPolicy {
  return value === "fixed" || value === "core_bundles" || value === "approved_selection";
}

function parseIntegerIds(raw: string | null | undefined): number[] | null {
  if (raw == null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !Array.isArray(parsed) ||
      parsed.some(
        (value) => typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0,
      )
    ) {
      return null;
    }
    return [...new Set(parsed)].sort((a, b) => a - b);
  } catch {
    return null;
  }
}

function parseStringIds(raw: string | null | undefined): string[] | null {
  if (raw == null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !Array.isArray(parsed) ||
      parsed.some((value) => typeof value !== "string" || value.trim() === "")
    ) {
      return null;
    }
    return [...new Set(parsed)];
  } catch {
    return null;
  }
}

function parseCatalogVersion(raw: string | null): number | null {
  if (raw == null || !/^[1-9]\d*$/.test(raw)) return null;
  return Number(raw);
}

/**
 * Read the versioned bundle catalog from stable bundle records. Malformed
 * records are excluded rather than treated as an empty/unrestricted bundle.
 */
export async function getLineupBundleCatalog(): Promise<LineupBundleCatalog> {
  const version = parseCatalogVersion(await getConfig(LINEUP_BUNDLE_CATALOG_VERSION_KEY));
  const { db } = await import("$lib/db/connection");
  const rows = db
    .prepare(
      "SELECT id, slug, display_name, enabled, group_ids, created_at, updated_at FROM lineup_bundles",
    )
    .all() as LineupBundle[];

  const bundles: ResolvedLineupBundle[] = [];
  for (const row of rows) {
    const groupIds = parseIntegerIds(row.group_ids);
    if (!row.id || !row.slug || !row.display_name || groupIds === null) continue;
    bundles.push({
      id: row.id,
      slug: row.slug,
      displayName: row.display_name,
      enabled: row.enabled === 1,
      groupIds,
    });
  }
  return { version: version ?? 0, bundles };
}

/** Read and validate instance policy settings. */
export async function getLineupPolicySettings(): Promise<LineupPolicySettings> {
  const [defaultRaw, fixedRaw, coreRaw, approvedRaw, catalogVersionRaw] = await Promise.all([
    getConfig(LINEUP_POLICY_DEFAULT_KEY),
    getConfig(LINEUP_FIXED_GROUP_IDS_KEY),
    getConfig(LINEUP_CORE_GROUP_IDS_KEY),
    getConfig(DEFAULT_SELECTABLE_GROUPS_KEY),
    getConfig(LINEUP_BUNDLE_CATALOG_VERSION_KEY),
  ]);
  return {
    defaultPolicy: isLineupPolicy(defaultRaw) ? defaultRaw : "core_bundles",
    fixedGroupIds: parseIntegerIds(fixedRaw) ?? [],
    coreGroupIds: parseIntegerIds(coreRaw) ?? [],
    approvedGroupIds: parseIntegerIds(approvedRaw),
    bundleCatalogVersion: parseCatalogVersion(catalogVersionRaw),
  };
}

/**
 * Pure least-privilege policy resolver. It never mutates stored intent:
 * missing, disabled, unapproved, or quarantined selections remain available
 * for a later catalog/live-group restoration.
 */
export function resolveLineupPolicy(input: LineupResolutionInput): LineupResolution {
  const policy = isLineupPolicy(input.user.lineup_policy_override)
    ? input.user.lineup_policy_override
    : isLineupPolicy(input.settings.defaultPolicy)
      ? input.settings.defaultPolicy
      : "core_bundles";
  const selectedBundleIds = parseStringIds(input.user.selected_bundle_ids) ?? [];
  const selectedApprovedGroupIds = parseIntegerIds(input.user.selected_approved_group_ids) ?? [];

  let requested: number[];
  if (policy === "fixed") {
    requested = input.settings.fixedGroupIds;
  } else if (policy === "core_bundles") {
    const selectedBundles = new Set(selectedBundleIds);
    requested = [
      ...input.settings.coreGroupIds,
      ...input.catalog.bundles
        .filter((bundle) => bundle.enabled && selectedBundles.has(bundle.id))
        .flatMap((bundle) => bundle.groupIds),
    ];
  } else {
    requested = selectedApprovedGroupIds;
  }

  const approved = input.settings.approvedGroupIds;
  const liveById = new Map(input.liveGroups.map((group) => [group.id, group]));
  const effectiveGroupIds =
    approved === null
      ? []
      : [...new Set(requested)]
          .filter((id) => {
            const group = liveById.get(id);
            return group !== undefined && approved.includes(id) && !isQuarantineGroup(group.name);
          })
          .sort((a, b) => a - b);

  return { policy, effectiveGroupIds, selectedBundleIds, selectedApprovedGroupIds };
}

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
  /** Explicitly approved group IDs offered by default. Empty means offer none. */
  selectableGroupIds: number[];
  /** Whether users may self-select their groups (global default). */
  allowSelfSelect: boolean;
}

function parseGroupIdList(raw: string | null): number[] {
  return parseIntegerIds(raw) ?? [];
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
 * and the explicit approved set. Always excludes quarantine groups and fails
 * closed when the approved set is absent, malformed, or empty.
 */
export function computeOfferedGroups(
  liveGroups: DispatcharrChannelGroup[],
  defaults: SubscriptionDefaults,
): DispatcharrChannelGroup[] {
  const allowed = new Set(defaults.selectableGroupIds);
  return liveGroups.filter((g) => !isQuarantineGroup(g.name) && allowed.has(g.id));
}

/** Return every explicitly offered group ID for a brand-new user's default intent. */
export function defaultSelectedGroupIds(offered: DispatcharrChannelGroup[]): number[] {
  return offered.map((g) => g.id);
}
