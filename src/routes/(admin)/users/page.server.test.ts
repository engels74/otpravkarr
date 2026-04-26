// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProvisioningRequest, ProvisioningResult } from "$lib/bridge/types";
import type { DispatcharrClient } from "$lib/dispatcharr/client";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => ({ id: 1, username: "admin" })),
  getConfig: vi.fn(async () => null as string | null),
  getAllUserMappings: vi.fn(() => []),
  getUserMappingById: vi.fn(
    () => null as { id: number; dispatcharr_user_id: number | null } | null,
  ),
  updateUserMapping: vi.fn(),
  listGroups: vi.fn(async () => ({ ok: true, data: [] })),
  listProfiles: vi.fn(async () => ({ ok: true, data: [] })),
  updateUser: vi.fn(async () => ({ ok: true, data: {} })),
  rotateCredentials: vi.fn(async () => undefined),
  disableUser: vi.fn(async () => undefined),
  enableUser: vi.fn(async () => undefined),
  provisionUser: vi.fn<() => Promise<ProvisioningResult>>(
    async () => ({ status: "provisioned", mapping: {} }) as ProvisioningResult,
  ),
  appendAuditLog: vi.fn(),
}));

vi.mock("$lib/server/auth", () => ({
  requireAdmin: mocks.requireAdmin,
}));

vi.mock("$lib/db/repositories/config", () => ({
  getConfig: mocks.getConfig,
}));

vi.mock("$lib/db/repositories/audit", () => ({
  appendAuditLog: mocks.appendAuditLog,
}));

vi.mock("$lib/db/repositories/users", () => ({
  getAllUserMappings: mocks.getAllUserMappings,
  getUserMappingById: mocks.getUserMappingById,
  updateUserMapping: mocks.updateUserMapping,
}));

vi.mock("$lib/dispatcharr/client", () => ({
  DispatcharrClient: class DispatcharrClient {},
}));

vi.mock("$lib/dispatcharr/endpoints/groups", () => ({
  listGroups: mocks.listGroups,
}));

vi.mock("$lib/dispatcharr/endpoints/profiles", () => ({
  listProfiles: mocks.listProfiles,
}));

vi.mock("$lib/dispatcharr/endpoints/users", () => ({
  updateUser: mocks.updateUser,
}));

vi.mock("$lib/bridge/lifecycle", () => ({
  rotateCredentials: mocks.rotateCredentials,
  disableUser: mocks.disableUser,
  enableUser: mocks.enableUser,
}));

vi.mock("$lib/bridge/provisioner", () => ({
  provisionUser: mocks.provisionUser,
}));

function resetMocks() {
  mocks.requireAdmin.mockClear();
  mocks.getConfig.mockClear();
  mocks.getAllUserMappings.mockClear();
  mocks.getUserMappingById.mockClear();
  mocks.updateUserMapping.mockClear();
  mocks.listGroups.mockClear();
  mocks.listProfiles.mockClear();
  mocks.updateUser.mockClear();
  mocks.rotateCredentials.mockClear();
  mocks.disableUser.mockClear();
  mocks.enableUser.mockClear();
  mocks.provisionUser.mockClear();
  mocks.appendAuditLog.mockClear();
}

function createActionEvent(body: FormData) {
  return {
    request: new Request("http://localhost/users", {
      method: "POST",
      body,
    }),
    getClientAddress: () => "127.0.0.1",
  };
}

describe("admin users actions", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("saves group IDs locally on changeGroup without calling Dispatcharr", async () => {
    const { actions } = await import("./+page.server");
    const changeGroup = actions.changeGroup;
    if (!changeGroup) throw new Error("changeGroup action is undefined");

    mocks.getUserMappingById.mockReturnValueOnce({
      id: 1,
      dispatcharr_user_id: 42,
      dispatcharr_group_ids: JSON.stringify([2]),
      plex_username: "alice",
    } as unknown as { id: number; dispatcharr_user_id: number | null });

    const body = new FormData();
    body.set("id", "1");
    body.set("group_ids", JSON.stringify([5, 7]));

    const result = await changeGroup(
      createActionEvent(body) as unknown as Parameters<typeof changeGroup>[0],
    );

    expect(result).toMatchObject({ success: true });
    expect(mocks.updateUserMapping).toHaveBeenCalledWith(1, {
      dispatcharr_group_ids: JSON.stringify([5, 7]),
    });
    expect(mocks.requireAdmin).toHaveBeenCalledOnce();
    expect(mocks.appendAuditLog).toHaveBeenCalledWith({
      actor: "admin",
      action: "user.group_changed",
      detail: {
        mapping_id: 1,
        plex_username: "alice",
        before: [2],
        after: [5, 7],
      },
      ipAddress: "127.0.0.1",
    });
  });

  describe("enableUser re-provision (dispatcharr_user_id is null)", () => {
    function makeOrphanedMapping(overrides?: Record<string, unknown>) {
      return {
        id: 1,
        plex_account_id: 12345,
        plex_uuid: "abc-uuid",
        plex_username: "testuser",
        plex_email: "test@example.com",
        plex_thumb: "https://plex.tv/users/abc/avatar",
        dispatcharr_user_id: null,
        dispatcharr_username: "testuser",
        dispatcharr_xc_password_enc: null,
        dispatcharr_group_ids: JSON.stringify([3, 5]),
        dispatcharr_profile_id: null,
        provisioning_mode: "automatic",
        is_active: 0,
        ...overrides,
      };
    }

    it("re-provisions in automatic mode and returns the one-time password", async () => {
      const { actions } = await import("./+page.server");
      const enableUserAction = actions.enableUser;
      if (!enableUserAction) throw new Error("enableUser action is undefined");

      mocks.getUserMappingById.mockReturnValueOnce(makeOrphanedMapping());
      mocks.getConfig.mockResolvedValueOnce("dispatcharr-url");
      mocks.getConfig.mockResolvedValueOnce("dispatcharr-api-key");
      mocks.getConfig.mockResolvedValueOnce("plex-token-123");
      mocks.provisionUser.mockResolvedValueOnce({
        status: "provisioned",
        mapping: {},
        initialPassword: "temp-pass-auto",
      } as ProvisioningResult);

      const body = new FormData();
      body.set("id", "1");

      const result = await enableUserAction(
        createActionEvent(body) as unknown as Parameters<typeof enableUserAction>[0],
      );

      expect(result).toMatchObject({ success: true, initialPassword: "temp-pass-auto" });
      expect(mocks.enableUser).not.toHaveBeenCalled();
      expect(mocks.provisionUser).toHaveBeenCalledOnce();
      const provisionCall = mocks.provisionUser.mock.calls[0] as unknown as [
        DispatcharrClient,
        ProvisioningRequest,
      ];
      expect(provisionCall[1]).toMatchObject({
        plexIdentity: {
          id: 12345,
          uuid: "abc-uuid",
          username: "testuser",
          email: "test@example.com",
          thumb: "https://plex.tv/users/abc/avatar",
          authenticationToken: "plex-token-123",
        },
        mode: "automatic",
        groupIds: [3, 5],
        exposeInitialPassword: true,
      });
    });

    it("re-provisions in self_managed mode (initialPassword returned)", async () => {
      const { actions } = await import("./+page.server");
      const enableUserAction = actions.enableUser;
      if (!enableUserAction) throw new Error("enableUser action is undefined");

      mocks.getUserMappingById.mockReturnValueOnce(
        makeOrphanedMapping({ provisioning_mode: "self_managed" }),
      );
      mocks.getConfig.mockResolvedValueOnce("dispatcharr-url");
      mocks.getConfig.mockResolvedValueOnce("dispatcharr-api-key");
      mocks.getConfig.mockResolvedValueOnce("plex-token-456");
      mocks.provisionUser.mockResolvedValueOnce({
        status: "provisioned",
        mapping: {},
        initialPassword: "temp-pass-abc",
      } as ProvisioningResult);

      const body = new FormData();
      body.set("id", "1");

      const result = await enableUserAction(
        createActionEvent(body) as unknown as Parameters<typeof enableUserAction>[0],
      );

      expect(result).toMatchObject({ success: true, initialPassword: "temp-pass-abc" });
      expect(mocks.enableUser).not.toHaveBeenCalled();
      expect(mocks.provisionUser).toHaveBeenCalledOnce();
      const provisionCall = mocks.provisionUser.mock.calls[0] as unknown as [
        DispatcharrClient,
        ProvisioningRequest,
      ];
      expect(provisionCall[1]).toMatchObject({ exposeInitialPassword: true });
    });

    it("returns fail(500) when provisionUser returns status 'failed'", async () => {
      const { actions } = await import("./+page.server");
      const enableUserAction = actions.enableUser;
      if (!enableUserAction) throw new Error("enableUser action is undefined");

      mocks.getUserMappingById.mockReturnValueOnce(makeOrphanedMapping());
      mocks.getConfig.mockResolvedValueOnce("dispatcharr-url");
      mocks.getConfig.mockResolvedValueOnce("dispatcharr-api-key");
      mocks.getConfig.mockResolvedValueOnce(null);
      mocks.provisionUser.mockResolvedValueOnce({
        status: "failed",
        error: "Dispatcharr API unreachable",
      } as ProvisioningResult);

      const body = new FormData();
      body.set("id", "1");

      const result = await enableUserAction(
        createActionEvent(body) as unknown as Parameters<typeof enableUserAction>[0],
      );

      expect(result).toMatchObject({
        status: 500,
        data: { error: "Dispatcharr API unreachable" },
      });
      expect(mocks.enableUser).not.toHaveBeenCalled();
    });

    it("falls back to empty groupIds when dispatcharr_group_ids is not a number array", async () => {
      const { actions } = await import("./+page.server");
      const enableUserAction = actions.enableUser;
      if (!enableUserAction) throw new Error("enableUser action is undefined");

      mocks.getUserMappingById.mockReturnValueOnce(
        makeOrphanedMapping({ dispatcharr_group_ids: JSON.stringify([3, "five"]) }),
      );
      mocks.getConfig.mockResolvedValueOnce("dispatcharr-url");
      mocks.getConfig.mockResolvedValueOnce("dispatcharr-api-key");
      mocks.getConfig.mockResolvedValueOnce(null);
      mocks.provisionUser.mockResolvedValueOnce({
        status: "provisioned",
        mapping: {},
      } as ProvisioningResult);

      const body = new FormData();
      body.set("id", "1");

      const result = await enableUserAction(
        createActionEvent(body) as unknown as Parameters<typeof enableUserAction>[0],
      );

      expect(result).toMatchObject({ success: true });
      const provisionCall = mocks.provisionUser.mock.calls[0] as unknown as [
        DispatcharrClient,
        ProvisioningRequest,
      ];
      expect(provisionCall[1]).toMatchObject({ groupIds: [] });
    });
  });

  it("changeProfile updates Dispatcharr and persists the local profile id", async () => {
    mocks.getConfig.mockResolvedValue("https://dispatcharr.example");

    const { actions } = await import("./+page.server");
    const changeProfile = actions.changeProfile;
    if (!changeProfile) throw new Error("changeProfile action is undefined");

    mocks.getUserMappingById.mockReturnValueOnce({
      id: 1,
      dispatcharr_user_id: 42,
      dispatcharr_profile_id: null,
      plex_username: "alice",
    } as unknown as { id: number; dispatcharr_user_id: number | null });

    const body = new FormData();
    body.set("id", "1");
    body.set("profile_id", "7");

    const result = await changeProfile(
      createActionEvent(body) as unknown as Parameters<typeof changeProfile>[0],
    );

    expect(result).toMatchObject({ success: true });
    expect(mocks.updateUser).toHaveBeenCalledWith(expect.anything(), 42, {
      channel_profiles: [7],
    });
    expect(mocks.updateUserMapping).toHaveBeenCalledWith(1, {
      dispatcharr_profile_id: 7,
    });
    expect(mocks.appendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "admin",
        action: "user.profile_changed",
        detail: expect.objectContaining({
          mapping_id: 1,
          plex_username: "alice",
          before: null,
          after: 7,
        }),
      }),
    );
  });

  it("changeProfile clears the profile when given an empty profile_id", async () => {
    mocks.getConfig.mockResolvedValue("https://dispatcharr.example");

    const { actions } = await import("./+page.server");
    const changeProfile = actions.changeProfile;
    if (!changeProfile) throw new Error("changeProfile action is undefined");

    mocks.getUserMappingById.mockReturnValueOnce({
      id: 1,
      dispatcharr_user_id: 42,
      dispatcharr_profile_id: 7,
      plex_username: "alice",
    } as unknown as { id: number; dispatcharr_user_id: number | null });

    const body = new FormData();
    body.set("id", "1");
    body.set("profile_id", "");

    const result = await changeProfile(
      createActionEvent(body) as unknown as Parameters<typeof changeProfile>[0],
    );

    expect(result).toMatchObject({ success: true });
    expect(mocks.updateUser).toHaveBeenCalledWith(expect.anything(), 42, {
      channel_profiles: [],
    });
    expect(mocks.updateUserMapping).toHaveBeenCalledWith(1, {
      dispatcharr_profile_id: null,
    });
  });

  it("changeProfile rejects users without a Dispatcharr account", async () => {
    mocks.getConfig.mockResolvedValue("https://dispatcharr.example");

    const { actions } = await import("./+page.server");
    const changeProfile = actions.changeProfile;
    if (!changeProfile) throw new Error("changeProfile action is undefined");

    mocks.getUserMappingById.mockReturnValueOnce({
      id: 1,
      dispatcharr_user_id: null,
      dispatcharr_profile_id: null,
      plex_username: "alice",
    } as unknown as { id: number; dispatcharr_user_id: number | null });

    const body = new FormData();
    body.set("id", "1");
    body.set("profile_id", "7");

    const result = await changeProfile(
      createActionEvent(body) as unknown as Parameters<typeof changeProfile>[0],
    );

    expect(result).toMatchObject({
      status: 400,
      data: { error: "User has no Dispatcharr account to update" },
    });
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.updateUserMapping).not.toHaveBeenCalled();
  });
});
