// ---------------------------------------------------------------------------
// M3U playlist generation — pure functions, no side effects
// ---------------------------------------------------------------------------

import type { DispatcharrChannel } from "../dispatcharr/types";
import { buildLiveStreamUrl } from "./xc";

/**
 * Parameters for M3U playlist generation.
 */
export interface M3UParams {
  channels: DispatcharrChannel[];
  host: string;
  username: string;
  password: string;
  /** @default 'http' */
  protocol?: "http" | "https";
}

/**
 * Generate an M3U playlist string from a list of Dispatcharr channels.
 *
 * - Only enabled channels are included
 * - Channels are sorted by `number` ascending
 * - Each channel produces an `#EXTINF` line followed by the stream URL
 */
export function generateM3U(params: M3UParams): string {
  const { channels, host, username, password, protocol } = params;

  const enabled = channels.filter((ch) => ch.enabled === true).sort((a, b) => a.number - b.number);

  let output = "#EXTM3U\n";

  for (const ch of enabled) {
    const url = buildLiveStreamUrl(
      { host, username, password, ...(protocol !== undefined ? { protocol } : {}) },
      ch.id,
    );
    output += `#EXTINF:-1 tvg-name="${ch.name}" tvg-chno="${ch.number}",${ch.name}\n`;
    output += `${url}\n`;
  }

  return output;
}
