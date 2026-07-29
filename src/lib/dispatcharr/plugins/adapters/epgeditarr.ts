import type { DispatcharrPlugin } from "../../types";
import type { PluginAdapter, PluginAdvisory } from "../types";

const EPGEDITARR_KEY = "epgeditarr";

function booleanState(plugin: DispatcharrPlugin, key: string): boolean | undefined {
  const value = plugin[key];
  return typeof value === "boolean" ? value : undefined;
}

function describeState(plugin: DispatcharrPlugin): string {
  const states: string[] = [];
  const missing = booleanState(plugin, "missing");
  const loaded = booleanState(plugin, "loaded");
  const trusted = booleanState(plugin, "trusted");
  const updateAvailable = booleanState(plugin, "update_available");
  const latestVersion = plugin.latest_version;

  states.push(missing ? "plugin files missing" : "installed");
  if (plugin.version) states.push(`version ${plugin.version}`);
  states.push(plugin.enabled ? "enabled" : "disabled");
  if (loaded !== undefined) states.push(loaded ? "loaded" : "not loaded");
  if (trusted !== undefined) states.push(trusted ? "trusted" : "not trusted");
  if (updateAvailable !== undefined) {
    states.push(
      updateAvailable
        ? `update available${typeof latestVersion === "string" && latestVersion ? ` (${latestVersion})` : ""}`
        : "up to date",
    );
  }

  return `EPGeditARR: ${states.join("; ")}.`;
}

/**
 * EPGeditARR transforms program data into virtual EPG sources and can fill
 * otherwise empty guides. It is observed only: Lineuparr owns lineups and ECM
 * owns visibility.
 */
export const epgeditarrAdapter: PluginAdapter = {
  key: EPGEDITARR_KEY,
  matches: (plugin) => plugin.key === EPGEDITARR_KEY,
  describe: describeState,
  advise: ({ plugin }) => {
    const advisories: PluginAdvisory[] = [];
    const missing = booleanState(plugin, "missing");
    const loaded = booleanState(plugin, "loaded");

    if (missing || !plugin.enabled || loaded === false) {
      advisories.push({
        level: "warning",
        message:
          "EPGeditARR must be installed, enabled, and loaded in Dispatcharr before its virtual or filler EPG output is available.",
      });
    }

    advisories.push({
      level: "warning",
      message:
        "Keep EPGeditARR channel rename and sorting actions off Lineuparr-owned lineups; Lineuparr remains the owner of lineup channels and ordering.",
    });
    advisories.push({
      level: "info",
      message:
        "EPGeditARR owns virtual and filler EPG data only. ECM owns channel visibility; otpravkarr only analyzes and reports this plugin's scope and never changes its settings or runs its actions.",
    });
    return advisories;
  },
};
