import type { PluginAdapter } from "../types";

/**
 * IPTV Checker: probes streams and renames/moves/deletes dead/slow/black
 * channels into quarantine groups (Graveyard/Slow/Black Screens). Channels
 * legitimately leave user-visible groups.
 */
export const iptvCheckerAdapter: PluginAdapter = {
  key: "iptv_checker",
  matches: (p) => p.key === "iptv_checker",
  describe: () =>
    "Probes streams; moves dead/slow/black channels into quarantine groups; emits a completion webhook.",
  advise: () => [
    {
      level: "info",
      message:
        "Quarantine groups (Graveyard, Slow, Black Screens) are automatically hidden from the subscribable group list.",
    },
  ],
};
