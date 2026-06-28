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
 * (PPV/sports/F1) per Channel Profile on a schedule and on `m3u_refresh`. Never
 * creates channels. otpravkarr's primary integration — for event automation to
 * reach all subscribers of a group, that group's otpravkarr profile must be in
 * ECM's `channel_profile_name`.
 */
export const eventChannelManagarrAdapter: PluginAdapter = {
  key: "event_channel_managarr",
  matches: (p) => p.key === "event_channel_managarr",
  describe: () =>
    "Toggles visibility of existing event channels per channel profile (schedule + m3u_refresh). Never creates channels.",
  advise: ({ plugin, ownedProfileNames }) => {
    const advisories: PluginAdvisory[] = [];
    const scope = new Set(parseCsv(plugin.settings?.channel_profile_name));
    const missing = ownedProfileNames.filter((name) => !scope.has(name));

    if (ownedProfileNames.length > 0 && missing.length > 0) {
      advisories.push({
        level: "warning",
        message: `These otpravkarr group profiles are not yet in ECM's "channel_profile_name"; otpravkarr adds them automatically on the next sync so event channels reach their subscribers: ${missing.join(", ")}.`,
      });
    } else if (ownedProfileNames.length > 0) {
      advisories.push({
        level: "info",
        message:
          "All otpravkarr group profiles are within ECM's scope (kept in sync automatically) — event automation reaches subscribers.",
      });
    }

    advisories.push({
      level: "info",
      message:
        "otpravkarr does not toggle channel visibility inside ECM-managed profiles; ECM owns within-profile event toggling.",
    });
    return advisories;
  },
};
