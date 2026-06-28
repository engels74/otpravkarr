import type { PluginAdapter } from "../types";

/**
 * EPG Janitor: heals/strips EPG data and may suffix channel names with
 * `[BadEPG]`. Low visibility-contention; mostly EPG churn.
 */
export const epgJanitorAdapter: PluginAdapter = {
  key: "epg_janitor",
  matches: (p) => p.key === "epg_janitor",
  describe: () => "Heals and strips EPG data; may suffix channel names with [BadEPG].",
  advise: () => [
    {
      level: "info",
      message:
        "EPG churn and occasional renames do not affect subscriptions — otpravkarr keys on IDs and does not manage EPG data.",
    },
  ],
};
