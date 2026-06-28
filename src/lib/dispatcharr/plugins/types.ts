import type { DispatcharrPlugin } from "../types";

export type AdvisoryLevel = "info" | "warning";

export interface PluginAdvisory {
  level: AdvisoryLevel;
  message: string;
}

export interface PluginAdapterContext {
  plugin: DispatcharrPlugin;
  /**
   * Names of the otpravkarr-owned channel profiles currently in use (one per
   * subscribed group + the empty profile). Adapters use this to check coverage,
   * e.g. whether ECM's scope includes the subscriber group-profiles.
   */
  ownedProfileNames: string[];
}

/**
 * A per-plugin adapter. Single-purpose, one file per plugin. All behavior is
 * advisory/read-only here — adapters never mutate Dispatcharr. Unknown plugins
 * fall back to generic handling (see registry.ts), so adding support for a new
 * plugin is just dropping in a new adapter file.
 */
export interface PluginAdapter {
  /** The Dispatcharr plugin `key` this adapter handles. */
  key: string;
  /** Identify the plugin generically (by key). */
  matches(plugin: DispatcharrPlugin): boolean;
  /** Human-readable one-liner for the admin UI. */
  describe(plugin: DispatcharrPlugin): string;
  /** Contention/coverage guidance for the admin UI. */
  advise(context: PluginAdapterContext): PluginAdvisory[];
}

/** Combined detection result surfaced to the admin panel. */
export interface DetectedPlugin {
  key: string;
  name: string;
  version: string | null;
  enabled: boolean;
  /** The adapter key that handled it, or null for a generic (unknown) plugin. */
  adapterKey: string | null;
  description: string;
  advisories: PluginAdvisory[];
}
