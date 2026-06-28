import type { PluginAdapter } from "../types";

/**
 * Lineuparr: creates whole lineups (groups + channels) and enables them in
 * channel profiles. Defines the channel/group universe; a Full Sync can remove
 * unmatched channels.
 */
export const lineuparrAdapter: PluginAdapter = {
  key: "lineuparr",
  matches: (p) => p.key === "lineuparr",
  describe: () => "Creates whole lineups (groups + channels) and enables them in channel profiles.",
  advise: () => [
    {
      level: "info",
      message:
        "Lineuparr defines the channel/group universe. A Full Sync may remove unmatched channels; otpravkarr reconciliation keys on IDs and re-scopes group profiles automatically.",
    },
  ],
};
