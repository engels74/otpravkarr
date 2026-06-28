import type { PluginAdapter } from "../types";

/**
 * Stream-Mapparr: matches streams→channels and also toggles channel visibility
 * (`manage_channel_visibility`/`visible_channel_limit`). A second writer of the
 * `enabled` membership bit — same ownership rule as ECM.
 */
export const streamMapparrAdapter: PluginAdapter = {
  key: "stream_mapparr",
  matches: (p) => p.key === "stream_mapparr",
  describe: () =>
    "Matches streams to channels and toggles channel visibility; refuses the 'All' profile; emits a webhook.",
  advise: () => [
    {
      level: "info",
      message:
        "Stream-Mapparr also writes channel visibility. otpravkarr only owns user→profile assignment and the membership of its own group profiles — it will not fight Stream-Mapparr's toggles.",
    },
  ],
};
