import { getConfig, setConfig } from "$lib/db/repositories/config";
import type { DispatcharrClient } from "$lib/dispatcharr/client";
import { listPlugins } from "$lib/dispatcharr/endpoints/plugins";
import { getQuarantineGroupNames, setQuarantineGroupNames } from "$lib/server/subscription-config";
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
 * straight from the IPTV Checker plugin config and folds them into the matcher
 * (always unioned with the built-in defaults, so the policy can only widen).
 * Renames now propagate automatically — no human has to update a constant.
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

/** Config key persisting the last resolved quarantine names (JSON string array). */
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
  source: "plugin" | "plugin_absent" | "error";
  /** Present when `source === "error"`. */
  error?: string;
}

/**
 * Resolve quarantine group names from the live IPTV Checker plugin and apply
 * them to the in-memory matcher, persisting the result to config so a restart
 * keeps tracking renamed groups before the next sync runs.
 *
 * Fail-safe: when the plugin is unreachable the current (already-defaults-or-
 * better) matcher is left untouched — the policy never narrows on a read error.
 */
export async function reconcileQuarantineGroups(
  client: DispatcharrClient,
): Promise<QuarantineSyncResult> {
  const list = await retryResult(() => listPlugins(client), isTransientResultError);
  if (!list.ok) {
    return { names: getQuarantineGroupNames(), source: "error", error: list.message };
  }

  const plugin = list.data.find((p) => p.key === IPTV_CHECKER_KEY);
  const pluginNames = extractQuarantineNames(plugin?.settings);

  // setQuarantineGroupNames always re-unions the built-in defaults, so passing
  // only the plugin names still yields defaults ∪ plugin names.
  setQuarantineGroupNames(pluginNames);
  const names = getQuarantineGroupNames();

  try {
    await setConfig(QUARANTINE_GROUP_NAMES_KEY, JSON.stringify(names));
  } catch {
    // Persistence is best-effort: the in-memory matcher is already updated for
    // this process. A failed write only means a restart re-derives from the
    // plugin on the next sync instead of from config.
  }

  return { names, source: plugin ? "plugin" : "plugin_absent" };
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
    if (Array.isArray(parsed)) {
      setQuarantineGroupNames(parsed.filter((v): v is string => typeof v === "string"));
    }
  } catch {
    // Malformed persisted value — keep the built-in defaults already in effect.
  }
}
