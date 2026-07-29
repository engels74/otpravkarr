import { isEcmCsvSafeProfileName, isEcmManagedGroupName } from "$lib/event-groups";
import type { PluginAdapter, PluginAdvisory } from "../types";

function parseCsv(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Event-Channel-Managarr (ECM): toggles visibility of existing event channels
 * per event Channel Profile on a schedule and on `m3u_refresh`. It never creates
 * channels. Otpravkarr reports missing event-profile scope but never mutates
 * plugin settings or runs plugin actions.
 */
export const eventChannelManagarrAdapter: PluginAdapter = {
  key: "event_channel_managarr",
  matches: (p) => p.key === "event_channel_managarr",
  describe: () =>
    "Toggles visibility of existing event channels per channel profile (schedule + m3u_refresh). Never creates channels.",
  advise: ({ plugin, ownedProfileNames }) => {
    const advisories: PluginAdvisory[] = [];
    const scope = new Set(parseCsv(plugin.settings?.channel_profile_name));
    const eventProfileNames = ownedProfileNames.filter(isEcmManagedGroupName);
    const unsafeProfileNames = eventProfileNames.filter((name) => !isEcmCsvSafeProfileName(name));
    const safeProfileNames = eventProfileNames.filter(isEcmCsvSafeProfileName);
    const missing = safeProfileNames.filter((name) => !scope.has(name));

    if (unsafeProfileNames.length > 0) {
      advisories.push({
        level: "warning",
        message: `These legacy otpravkarr event profile names cannot be represented in ECM's comma-separated scope and were omitted: ${unsafeProfileNames.join("; ")}. Reconcile the group profile, then update ECM scope in Dispatcharr.`,
      });
    }

    if (missing.length > 0) {
      advisories.push({
        level: "warning",
        message: `These otpravkarr event profiles are missing from ECM's "channel_profile_name": ${missing.join(", ")}. Update ECM scope in Dispatcharr; otpravkarr advisory is read-only.`,
      });
    } else if (safeProfileNames.length > 0) {
      advisories.push({
        level: "info",
        message:
          "All otpravkarr event profiles are within ECM's channel_profile_name scope. ECM visibility automation reaches their subscribers.",
      });
    }

    advisories.push({
      level: "info",
      message:
        "otpravkarr reports ECM event-profile scope only; it never changes plugin settings or runs actions. ECM owns visibility inside configured event profiles.",
    });
    return advisories;
  },
};
