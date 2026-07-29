import { describe, expect, it } from "vitest";
import type { DispatcharrPlugin } from "../../types";
import { describePlugins, getAdapterFor } from "../registry";

function plugin(overrides: Partial<DispatcharrPlugin> & { key: string }): DispatcharrPlugin {
  return { name: overrides.key, enabled: true, ...overrides };
}

describe("getAdapterFor", () => {
  it("resolves the adapter for each of the seven known plugins", () => {
    for (const key of [
      "event_channel_managarr",
      "iptv_checker",
      "stream_mapparr",
      "channel_mapparr",
      "epg_janitor",
      "lineuparr",
      "epgeditarr",
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

  it("describes installed EPGeditARR state and its advisory-only ownership boundary", () => {
    const detected = describePlugins(
      [
        plugin({
          key: "epgeditarr",
          name: "EPGeditARR",
          version: "0.2.10",
          loaded: true,
          trusted: true,
          update_available: true,
          latest_version: "0.2.11",
        }),
      ],
      [],
    );

    expect(detected[0]).toMatchObject({
      key: "epgeditarr",
      adapterKey: "epgeditarr",
      version: "0.2.10",
    });
    expect(detected[0]?.description).toContain("installed");
    expect(detected[0]?.description).toContain("enabled");
    expect(detected[0]?.description).toContain("loaded");
    expect(detected[0]?.description).toContain("trusted");
    expect(detected[0]?.description).toContain("update available (0.2.11)");
    expect(
      detected[0]?.advisories.some((advisory) => advisory.message.includes("never changes")),
    ).toBe(true);
  });

  it("warns when EPGeditARR is disabled", () => {
    const detected = describePlugins(
      [plugin({ key: "epgeditarr", enabled: false, loaded: false })],
      [],
    );

    expect(detected[0]?.adapterKey).toBe("epgeditarr");
    expect(detected[0]?.description).toContain("disabled");
    expect(detected[0]?.advisories.some((advisory) => advisory.level === "warning")).toBe(true);
  });

  it("warns when EPGeditARR plugin files are missing", () => {
    const detected = describePlugins([plugin({ key: "epgeditarr", missing: true })], []);

    expect(detected[0]?.adapterKey).toBe("epgeditarr");
    expect(detected[0]?.description).toContain("plugin files missing");
    expect(detected[0]?.advisories.some((advisory) => advisory.level === "warning")).toBe(true);
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

  it("warns only when otpravkarr event profiles are outside ECM's scope", () => {
    const ecm = plugin({
      key: "event_channel_managarr",
      name: "ECM",
      settings: { channel_profile_name: "Streamers" },
    });
    const detected = describePlugins(
      [ecm],
      [
        "otpravkarr:g1:Sports",
        "otpravkarr:g2:UK/English — PPV/Events",
        "otpravkarr:g3:UK/English — Unscheduled Events",
      ],
    );
    const warning = detected[0]?.advisories.find((a) => a.level === "warning");
    expect(warning?.message).not.toContain("otpravkarr:g1:Sports");
    expect(warning?.message).toContain("otpravkarr:g2:UK/English — PPV/Events");
    expect(warning?.message).toContain("otpravkarr:g3:UK/English — Unscheduled Events");
    expect(warning?.message).toContain("Update ECM scope in Dispatcharr");
    expect(warning?.message).toContain("read-only");
    expect(warning?.message).not.toContain("automatically");
  });

  it("reports ECM coverage as healthy when all event profiles are in scope", () => {
    const profileName = "otpravkarr:g2:UK/English — PPV/Events";
    const ecm = plugin({
      key: "event_channel_managarr",
      name: "ECM",
      settings: { channel_profile_name: `${profileName}, Streamers` },
    });
    const detected = describePlugins([ecm], ["otpravkarr:g1:Sports", profileName]);
    expect(detected[0]?.advisories.some((a) => a.level === "warning")).toBe(false);
    expect(
      detected[0]?.advisories.some(
        (a) => a.level === "info" && a.message.includes("event profiles"),
      ),
    ).toBe(true);
    expect(detected[0]?.advisories.every((a) => !a.message.includes("automatically"))).toBe(true);
  });

  it("ignores ordinary profiles and keeps ECM integration explicitly read-only", () => {
    const ecm = plugin({
      key: "event_channel_managarr",
      name: "ECM",
      settings: {},
    });
    const detected = describePlugins([ecm], ["otpravkarr:g1:Sports", "otpravkarr:g2:General TV"]);

    expect(detected[0]?.advisories.some((a) => a.level === "warning")).toBe(false);
    expect(
      detected[0]?.advisories.some(
        (a) =>
          a.level === "info" && a.message.includes("never changes plugin settings or runs actions"),
      ),
    ).toBe(true);
  });
});
