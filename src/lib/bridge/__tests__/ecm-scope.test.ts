// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DispatcharrClient } from "$lib/dispatcharr/client";

const mocks = vi.hoisted(() => ({
  getAllGroupProfiles: vi.fn(),
  listPlugins: vi.fn(),
  updatePluginSettings: vi.fn(),
  appendAuditLog: vi.fn(),
}));

vi.mock("$lib/db/repositories/channel-group-profiles", () => ({
  EMPTY_PROFILE_GROUP_ID: -1,
  getAllGroupProfiles: mocks.getAllGroupProfiles,
}));

vi.mock("$lib/dispatcharr/endpoints/plugins", () => ({
  listPlugins: mocks.listPlugins,
  updatePluginSettings: mocks.updatePluginSettings,
}));

vi.mock("$lib/db/repositories/audit", () => ({
  appendAuditLog: mocks.appendAuditLog,
}));

const { reconcileEcmScope, ECM_KEY } = await import("../ecm-scope");

const client = {} as DispatcharrClient;

function profile(groupId: number, name: string) {
  return { group_id: groupId, profile_id: groupId * 10, profile_name: name };
}

function ecmPlugin(settings: Record<string, unknown>) {
  return { key: ECM_KEY, name: "ECM", enabled: true, settings };
}

beforeEach(() => {
  mocks.getAllGroupProfiles.mockReset();
  mocks.listPlugins.mockReset();
  mocks.updatePluginSettings.mockReset().mockResolvedValue({ ok: true, data: {} });
  mocks.appendAuditLog.mockReset();
});

describe("reconcileEcmScope", () => {
  it("appends missing owned profiles while preserving existing scope and other settings", async () => {
    mocks.getAllGroupProfiles.mockReturnValue([
      profile(-1, "otpravkarr:empty"), // sentinel — must be excluded
      profile(1, "otpravkarr:g1:Sports"),
      profile(2, "otpravkarr:g2:News"),
    ]);
    mocks.listPlugins.mockResolvedValue({
      ok: true,
      data: [
        ecmPlugin({
          channel_profile_name: "Streamers, otpravkarr:g1:Sports",
          some_other_setting: 42,
        }),
      ],
    });

    const result = await reconcileEcmScope(client);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.updated).toBe(true);
      expect(result.data.added).toEqual(["otpravkarr:g2:News"]);
    }
    // Read-modify-write: other settings preserved, admin's "Streamers" kept,
    // missing profile appended, sentinel never added.
    expect(mocks.updatePluginSettings).toHaveBeenCalledWith(client, ECM_KEY, {
      some_other_setting: 42,
      channel_profile_name: "Streamers, otpravkarr:g1:Sports, otpravkarr:g2:News",
    });
    expect(mocks.appendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ecm.scope_updated" }),
    );
  });

  it("is a no-op when every owned profile is already in scope", async () => {
    mocks.getAllGroupProfiles.mockReturnValue([profile(1, "otpravkarr:g1:Sports")]);
    mocks.listPlugins.mockResolvedValue({
      ok: true,
      data: [ecmPlugin({ channel_profile_name: "otpravkarr:g1:Sports" })],
    });

    const result = await reconcileEcmScope(client);

    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.data).toMatchObject({ updated: false, reason: "already_in_scope" });
    expect(mocks.updatePluginSettings).not.toHaveBeenCalled();
    expect(mocks.appendAuditLog).not.toHaveBeenCalled();
  });

  it("does nothing (no plugin fetch) when otpravkarr owns no group profiles", async () => {
    mocks.getAllGroupProfiles.mockReturnValue([profile(-1, "otpravkarr:empty")]);

    const result = await reconcileEcmScope(client);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.reason).toBe("no_owned_profiles");
    expect(mocks.listPlugins).not.toHaveBeenCalled();
  });

  it("is a no-op when ECM is not installed", async () => {
    mocks.getAllGroupProfiles.mockReturnValue([profile(1, "otpravkarr:g1:Sports")]);
    mocks.listPlugins.mockResolvedValue({
      ok: true,
      data: [{ key: "iptv_checker", name: "IPTV Checker", enabled: true, settings: {} }],
    });

    const result = await reconcileEcmScope(client);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.reason).toBe("ecm_absent");
    expect(mocks.updatePluginSettings).not.toHaveBeenCalled();
  });

  it("seeds an empty scope from scratch", async () => {
    mocks.getAllGroupProfiles.mockReturnValue([profile(1, "otpravkarr:g1:Sports")]);
    mocks.listPlugins.mockResolvedValue({
      ok: true,
      data: [ecmPlugin({})],
    });

    const result = await reconcileEcmScope(client);
    expect(result.ok).toBe(true);
    expect(mocks.updatePluginSettings).toHaveBeenCalledWith(client, ECM_KEY, {
      channel_profile_name: "otpravkarr:g1:Sports",
    });
  });

  it("propagates a plugin list failure", async () => {
    mocks.getAllGroupProfiles.mockReturnValue([profile(1, "otpravkarr:g1:Sports")]);
    mocks.listPlugins.mockResolvedValue({ ok: false, error: "auth_failure", message: "401" });

    const result = await reconcileEcmScope(client);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("auth_failure");
  });

  it("propagates a settings write failure without auditing", async () => {
    mocks.getAllGroupProfiles.mockReturnValue([profile(1, "otpravkarr:g1:Sports")]);
    mocks.listPlugins.mockResolvedValue({ ok: true, data: [ecmPlugin({})] });
    mocks.updatePluginSettings.mockResolvedValue({
      ok: false,
      error: "validation_error",
      message: "rejected",
    });

    const result = await reconcileEcmScope(client);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("validation_error");
    expect(mocks.appendAuditLog).not.toHaveBeenCalled();
  });
});
