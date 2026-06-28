import type { PluginAdapter } from "../types";

/**
 * Channel Mapparr: standardizes channel names, imports M3U, and creates/
 * reorganizes groups. Names and group membership churn frequently.
 */
export const channelMapparrAdapter: PluginAdapter = {
  key: "channel_mapparr",
  matches: (p) => p.key === "channel_mapparr",
  describe: () =>
    "Standardizes channel names; imports M3U; creates and reorganizes channel groups.",
  advise: () => [
    {
      level: "info",
      message:
        "Group renames and regrouping are tolerated — otpravkarr keys subscriptions on stable group/channel IDs, never names, and reconciliation corrects membership.",
    },
  ],
};
