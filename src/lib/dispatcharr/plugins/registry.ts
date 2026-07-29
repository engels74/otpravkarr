import type { DispatcharrPlugin } from "../types";
import { channelMapparrAdapter } from "./adapters/channel-mapparr";
import { epgJanitorAdapter } from "./adapters/epg-janitor";
import { epgeditarrAdapter } from "./adapters/epgeditarr";
import { eventChannelManagarrAdapter } from "./adapters/event-channel-managarr";
import { iptvCheckerAdapter } from "./adapters/iptv-checker";
import { lineuparrAdapter } from "./adapters/lineuparr";
import { streamMapparrAdapter } from "./adapters/stream-mapparr";
import type { DetectedPlugin, PluginAdapter } from "./types";

/**
 * Registry of per-plugin adapters. Adding support for a new plugin is just
 * dropping in a new adapter file and registering it here. Unknown plugins still
 * surface generically (see describePlugins).
 */
export const pluginAdapters: PluginAdapter[] = [
  eventChannelManagarrAdapter,
  iptvCheckerAdapter,
  streamMapparrAdapter,
  channelMapparrAdapter,
  epgJanitorAdapter,
  epgeditarrAdapter,
  lineuparrAdapter,
];

export function getAdapterFor(plugin: DispatcharrPlugin): PluginAdapter | null {
  return pluginAdapters.find((adapter) => adapter.matches(plugin)) ?? null;
}

/**
 * Combine live plugin entries with their adapter (or a generic fallback) into a
 * display-ready list for the admin panel. `ownedProfileNames` are the
 * otpravkarr group-profile names used for coverage checks (e.g. ECM scope).
 */
export function describePlugins(
  plugins: DispatcharrPlugin[],
  ownedProfileNames: string[],
): DetectedPlugin[] {
  return plugins.map((plugin) => {
    const adapter = getAdapterFor(plugin);
    const base = {
      key: plugin.key,
      name: plugin.name,
      version: plugin.version ?? null,
      enabled: plugin.enabled,
    };
    if (adapter) {
      return {
        ...base,
        adapterKey: adapter.key,
        description: adapter.describe(plugin),
        advisories: adapter.advise({ plugin, ownedProfileNames }),
      };
    }
    // Generic fallback for plugins with no dedicated adapter.
    return {
      ...base,
      adapterKey: null,
      description: "Installed plugin detected generically (no otpravkarr adapter).",
      advisories: [],
    };
  });
}
