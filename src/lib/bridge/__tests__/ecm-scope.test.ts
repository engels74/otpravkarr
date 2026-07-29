// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DispatcharrClient } from "$lib/dispatcharr/client";

const mocks = vi.hoisted(() => {
  const mutationAttempt = (endpoint: string) =>
    vi.fn(() => {
      throw new Error(`ECM analysis must not call ${endpoint}`);
    });

  return {
    getAllGroupProfiles: vi.fn(),
    listPlugins: vi.fn(),
    updatePluginSettings: mutationAttempt("plugin settings"),
    runPlugin: mutationAttempt("plugin run"),
    enablePlugin: mutationAttempt("plugin enable"),
    disablePlugin: mutationAttempt("plugin disable"),
  };
});

vi.mock("$lib/db/repositories/channel-group-profiles", () => ({
  EMPTY_PROFILE_GROUP_ID: -1,
  getAllGroupProfiles: mocks.getAllGroupProfiles,
}));
vi.mock("$lib/dispatcharr/endpoints/plugins", () => ({
  listPlugins: mocks.listPlugins,
  updatePluginSettings: mocks.updatePluginSettings,
  runPlugin: mocks.runPlugin,
  enablePlugin: mocks.enablePlugin,
  disablePlugin: mocks.disablePlugin,
}));

const { analyzeEcmScope, ECM_KEY } = await import("../ecm-scope");

const client = {} as DispatcharrClient;

function profile(groupId: number, name: string) {
  return {
    group_id: groupId,
    profile_id: groupId * 10,
    profile_name: name,
    known_channel_ids: "[]",
  };
}

function ecmPlugin(settings: Record<string, unknown>, enabled = true) {
  return { key: ECM_KEY, name: "ECM", enabled, settings };
}

function expectNoPluginMutation() {
  expect(mocks.updatePluginSettings).not.toHaveBeenCalled();
  expect(mocks.runPlugin).not.toHaveBeenCalled();
  expect(mocks.enablePlugin).not.toHaveBeenCalled();
  expect(mocks.disablePlugin).not.toHaveBeenCalled();
}

beforeEach(() => {
  mocks.getAllGroupProfiles.mockReset();
  mocks.listPlugins.mockReset();
  mocks.updatePluginSettings.mockClear();
  mocks.runPlugin.mockClear();
  mocks.enablePlugin.mockClear();
  mocks.disablePlugin.mockClear();
});

describe("analyzeEcmScope", () => {
  it("reports a missing ECM plugin and preserves the owned-profile discrepancy", async () => {
    mocks.getAllGroupProfiles.mockReturnValue([
      profile(1, "otpravkarr:g1:UK/English — PPV/Events"),
    ]);
    mocks.listPlugins.mockResolvedValue({ ok: true, data: [] });

    const result = await analyzeEcmScope(client);

    expect(result).toEqual({
      ok: true,
      data: {
        plugin: { present: false },
        missingProfileNames: ["otpravkarr:g1:UK/English — PPV/Events"],
        reason: "ecm_absent",
        skippedUnsafeProfiles: [],
      },
    });
    expectNoPluginMutation();
  });

  it("reports a disabled ECM plugin and its settings without changing it", async () => {
    mocks.getAllGroupProfiles.mockReturnValue([
      profile(1, "otpravkarr:g1:UK/English — PPV/Events"),
    ]);
    mocks.listPlugins.mockResolvedValue({
      ok: true,
      data: [ecmPlugin({ channel_profile_name: "Streamers", preserve: 42 }, false)],
    });

    const result = await analyzeEcmScope(client);

    expect(result).toEqual({
      ok: true,
      data: {
        plugin: {
          present: true,
          enabled: false,
          settings: { channel_profile_name: "Streamers", preserve: 42 },
        },
        missingProfileNames: ["otpravkarr:g1:UK/English — PPV/Events"],
        reason: "ecm_disabled",
        skippedUnsafeProfiles: [],
      },
    });
    expectNoPluginMutation();
  });

  it("reports covered scope while retaining the observed plugin state and settings", async () => {
    mocks.getAllGroupProfiles.mockReturnValue([
      profile(-1, "otpravkarr:empty"),
      profile(1, "otpravkarr:g1:UK/English — PPV/Events"),
    ]);
    mocks.listPlugins.mockResolvedValue({
      ok: true,
      data: [
        ecmPlugin({
          channel_profile_name: "Streamers, otpravkarr:g1:UK/English — PPV/Events",
          preserve: 42,
        }),
      ],
    });

    const result = await analyzeEcmScope(client);

    expect(result).toEqual({
      ok: true,
      data: {
        plugin: {
          present: true,
          enabled: true,
          settings: {
            channel_profile_name: "Streamers, otpravkarr:g1:UK/English — PPV/Events",
            preserve: 42,
          },
        },
        missingProfileNames: [],
        reason: "scope_covered",
        skippedUnsafeProfiles: [],
      },
    });
    expectNoPluginMutation();
  });

  it("reports unsafe profile names without trying to repair ECM settings", async () => {
    mocks.getAllGroupProfiles.mockReturnValue([
      profile(1, "otpravkarr:g1:UK, Live — PPV/Events"),
      profile(2, "otpravkarr:g2:UK/English — Unscheduled Events"),
    ]);
    mocks.listPlugins.mockResolvedValue({
      ok: true,
      data: [ecmPlugin({ channel_profile_name: "otpravkarr:g2:UK/English — Unscheduled Events" })],
    });

    const result = await analyzeEcmScope(client);

    expect(result).toEqual({
      ok: true,
      data: {
        plugin: {
          present: true,
          enabled: true,
          settings: { channel_profile_name: "otpravkarr:g2:UK/English — Unscheduled Events" },
        },
        missingProfileNames: [],
        reason: "scope_covered",
        skippedUnsafeProfiles: [
          {
            groupId: 1,
            profileId: 10,
            profileName: "otpravkarr:g1:UK, Live — PPV/Events",
            reason: "csv_unsafe",
          },
        ],
      },
    });
    expectNoPluginMutation();
  });

  it("reports an empty ECM scope as missing rather than populating it", async () => {
    mocks.getAllGroupProfiles.mockReturnValue([
      profile(1, "otpravkarr:g1:UK/English — PPV/Events"),
    ]);
    mocks.listPlugins.mockResolvedValue({ ok: true, data: [ecmPlugin({})] });

    const result = await analyzeEcmScope(client);

    expect(result).toEqual({
      ok: true,
      data: {
        plugin: { present: true, enabled: true, settings: {} },
        missingProfileNames: ["otpravkarr:g1:UK/English — PPV/Events"],
        skippedUnsafeProfiles: [],
      },
    });
    expectNoPluginMutation();
  });

  it("lists ECM state even when otpravkarr owns no group profiles", async () => {
    mocks.getAllGroupProfiles.mockReturnValue([profile(-1, "otpravkarr:empty")]);
    mocks.listPlugins.mockResolvedValue({ ok: true, data: [ecmPlugin({ preserve: 42 })] });

    const result = await analyzeEcmScope(client);

    expect(result).toEqual({
      ok: true,
      data: {
        plugin: { present: true, enabled: true, settings: { preserve: 42 } },
        missingProfileNames: [],
        reason: "no_owned_profiles",
        skippedUnsafeProfiles: [],
      },
    });
    expectNoPluginMutation();
  });

  it("ignores non-event profiles because ECM does not own their visibility", async () => {
    mocks.getAllGroupProfiles.mockReturnValue([
      profile(1, "otpravkarr:g1:Sports"),
      profile(2, "otpravkarr:g2:UK/English — PPV/Events"),
    ]);
    mocks.listPlugins.mockResolvedValue({
      ok: true,
      data: [ecmPlugin({ channel_profile_name: "otpravkarr:g2:UK/English — PPV/Events" })],
    });

    const result = await analyzeEcmScope(client);

    expect(result).toMatchObject({
      ok: true,
      data: {
        missingProfileNames: [],
        reason: "scope_covered",
      },
    });
    expectNoPluginMutation();
  });
  it("preserves no-throw Dispatcharr failures", async () => {
    mocks.getAllGroupProfiles.mockReturnValue([
      profile(1, "otpravkarr:g1:UK/English — PPV/Events"),
    ]);
    mocks.listPlugins.mockResolvedValue({ ok: false, error: "auth_failure", message: "401" });

    const result = await analyzeEcmScope(client);

    expect(result).toEqual({ ok: false, error: "auth_failure", message: "401" });
    expectNoPluginMutation();
  });
});
