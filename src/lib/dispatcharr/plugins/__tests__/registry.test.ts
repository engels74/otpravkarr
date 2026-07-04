import { describe, expect, it } from "vitest";
import type { DispatcharrPlugin } from "../../types";
import { describePlugins, getAdapterFor } from "../registry";

function plugin(overrides: Partial<DispatcharrPlugin> & { key: string }): DispatcharrPlugin {
  return { name: overrides.key, enabled: true, ...overrides };
}

describe("getAdapterFor", () => {
  it("resolves the adapter for each of the six known plugins", () => {
    for (const key of [
      "event_channel_managarr",
      "iptv_checker",
      "stream_mapparr",
      "channel_mapparr",
      "epg_janitor",
      "lineuparr",
    ]) {
      expect(getAdapterFor(plugin({ key }))?.key).toBe(key);
    }
  });

  it("returns null for an unknown plugin", () => {
    expect(getAdapterFor(plugin({ key: "some_new_plugin" }))).toBeNull();
  });
});

describe("describePlugins", () => {
  it("describes known plugins with their adapter and advisories", () => {
    const detected = describePlugins([plugin({ key: "iptv_checker", name: "IPTV Checker" })], []);
    expect(detected[0]).toMatchObject({
      key: "iptv_checker",
      adapterKey: "iptv_checker",
    });
    expect(detected[0]?.advisories.length).toBeGreaterThan(0);
  });

  it("falls back generically for unknown plugins (adapterKey null, no advisories)", () => {
    const detected = describePlugins(
      [plugin({ key: "mystery_plugin", name: "Mystery", version: "9.9" })],
      [],
    );
    expect(detected[0]).toMatchObject({
      key: "mystery_plugin",
      name: "Mystery",
      version: "9.9",
      adapterKey: null,
      advisories: [],
    });
  });

  it("warns when otpravkarr group profiles are outside ECM's scope", () => {
    const ecm = plugin({
      key: "event_channel_managarr",
      name: "ECM",
      settings: { channel_profile_name: "Streamers" },
    });
    const detected = describePlugins([ecm], ["otpravkarr:g1:Sports", "otpravkarr:g2:News"]);
    const warning = detected[0]?.advisories.find((a) => a.level === "warning");
    expect(warning?.message).toContain("otpravkarr:g1:Sports");
    expect(warning?.message).toContain("otpravkarr:g2:News");
  });

  it("reports ECM coverage as healthy when all group profiles are in scope", () => {
    const ecm = plugin({
      key: "event_channel_managarr",
      name: "ECM",
      settings: { channel_profile_name: "otpravkarr:g1:Sports, Streamers" },
    });
    const detected = describePlugins([ecm], ["otpravkarr:g1:Sports"]);
    expect(detected[0]?.advisories.some((a) => a.level === "warning")).toBe(false);
    expect(
      detected[0]?.advisories.some(
        (a) => a.level === "info" && a.message.includes("channel_profile_name"),
      ),
    ).toBe(true);
  });
});
