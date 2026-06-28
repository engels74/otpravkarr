import { getConfig, setConfig } from "$lib/db/repositories/config";
import type { DispatcharrClient } from "$lib/dispatcharr/client";
import { listPlugins } from "$lib/dispatcharr/endpoints/plugins";
import {
  applyPersistedQuarantineGroupState,
  getQuarantineGroupNames,
  getQuarantineGroupState,
  setQuarantineGroupNames,
} from "$lib/server/subscription-config";
import { isTransientResultError, retryResult } from "$lib/utils/retry";

/**
 * Automatic safety net for the name-based quarantine policy.
 *
 * Quarantine groups (dead/slow/black-screen channels) are created by the IPTV
 * Checker plugin, which exposes their names as editable settings. otpravkarr
 * hides those groups from the subscribable list by NAME (see
 * `isQuarantineGroup`). If an admin renames a quarantine group inside the
 * plugin, a hardcoded name list would silently stop matching it and quarantine
 * channels would leak into what users are offered.
 *
 * This module removes that footgun: it reads the live quarantine-group names
 * straight from the IPTV Checker plugin config and folds them into the matcher.
 * Successful reads replace the plugin-derived set wholesale (so stale plugin
 * names can be pruned) while always unioning the built-in defaults. Failed,
 * absent, or empty reads leave the existing matcher untouched.
 */

/** Dispatcharr plugin key for the IPTV Checker plugin. */
const IPTV_CHECKER_KEY = "iptv_checker";

/**
 * IPTV Checker settings whose VALUES are quarantine destination group names.
 * Defaults (plugin factory): Graveyard / Black Screens / Slow respectively.
 * Sourced from the plugin manifest (PiratesIRC/Dispatcharr-IPTV-Checker-Plugin).
 */
const QUARANTINE_NAME_FIELDS = [
  "move_to_group_name",
  "move_black_screen_group",
  "move_low_framerate_group",
] as const;

/** Config key persisting the source-aware quarantine state (legacy: JSON array). */
export const QUARANTINE_GROUP_NAMES_KEY = "quarantine_group_names";

function extractQuarantineNames(settings: Record<string, unknown> | undefined): string[] {
  if (!settings) return [];
  const names: string[] = [];
  for (const field of QUARANTINE_NAME_FIELDS) {
    const value = settings[field];
    if (typeof value === "string" && value.trim() !== "") {
      names.push(value.trim());
    }
  }
  return names;
}

export interface QuarantineSyncResult {
  /** Quarantine names now in effect (defaults ∪ plugin-configured). */
  names: string[];
  /** Where the plugin-configured names came from this cycle. */
  source: "plugin" | "plugin_absent" | "plugin_empty" | "error";
  /** Present when `source === "error"`. */
  error?: string;
}

/**
 * Resolve quarantine group names from the live IPTV Checker plugin and apply
 * them to the in-memory matcher, persisting the result to config so a restart
 * keeps tracking renamed groups before the next sync runs.
 *
 * Fail-safe: when the plugin list can't be read, the plugin is absent from the
 * live list (disabled/uninstalled), OR the plugin is present but its settings
 * yield no usable quarantine names (fields omitted/blank or shape-mismatched),
 * its configured names are unavailable — not authoritatively empty — so the
 * current matcher is left untouched. The policy never narrows on missing plugin
 * info; only a present plugin reporting usable names updates it.
 */
export async function reconcileQuarantineGroups(
  client: DispatcharrClient,
): Promise<QuarantineSyncResult> {
  const list = await retryResult(() => listPlugins(client), isTransientResultError);
  if (!list.ok) {
    return { names: getQuarantineGroupNames(), source: "error", error: list.message };
  }

  const plugin = list.data.find((p) => p.key === IPTV_CHECKER_KEY);
  if (!plugin) {
    // Plugin not in the live list (disabled/uninstalled). Like a read error,
    // its configured names are unavailable — not authoritatively empty — so
    // leave the current matcher untouched rather than narrowing back to
    // defaults and re-exposing already-resolved renamed quarantine groups.
    return { names: getQuarantineGroupNames(), source: "plugin_absent" };
  }

  const pluginNames = extractQuarantineNames(plugin.settings);
  if (pluginNames.length === 0) {
    // Plugin present but its settings yielded no usable quarantine names (fields
    // omitted, shape-mismatched, or all blank). We can't distinguish that from a
    // transient/garbled read, so — like the absent/error paths — leave the
    // current matcher untouched rather than narrowing back to defaults and
    // re-exposing already-resolved renamed quarantine groups.
    return { names: getQuarantineGroupNames(), source: "plugin_empty" };
  }

  const refreshedAt = new Date().toISOString();
  // Replaces plugin-derived names wholesale while always re-unioning built-in
  // defaults, so successful reads prune stale plugin names without exposing the
  // factory default quarantine groups.
  setQuarantineGroupNames(pluginNames, { source: "plugin", refreshedAt });
  const state = getQuarantineGroupState();

  try {
    await setConfig(QUARANTINE_GROUP_NAMES_KEY, JSON.stringify(state));
  } catch {
    // Persistence is best-effort: the in-memory matcher is already updated for
    // this process. A failed write only means a restart re-derives from the
    // plugin on the next sync instead of from config.
  }

  return { names: state.resolvedNames, source: "plugin" };
}

/**
 * Hydrate the quarantine matcher from the last persisted resolution. Call once
 * at startup so renamed quarantine groups stay hidden during the window before
 * the first sync cycle reconciles against the live plugin. No network I/O.
 */
export async function hydrateQuarantineGroupsFromConfig(): Promise<void> {
  let raw: string | null;
  try {
    raw = await getConfig(QUARANTINE_GROUP_NAMES_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const parsed: unknown = JSON.parse(raw);
    applyPersistedQuarantineGroupState(parsed);
  } catch {
    // Malformed persisted value — keep the built-in defaults already in effect.
  }
}
