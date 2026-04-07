// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProvisioningRequest, ProvisioningResult } from "$lib/bridge/types";
import type { DispatcharrClient } from "$lib/dispatcharr/client";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => undefined),
  getConfig: vi.fn(async () => null as string | null),
  getAllUserMappings: vi.fn(() => []),
  getUserMappingById: vi.fn(
    () => null as { id: number; dispatcharr_user_id: number | null } | null,
  ),
  updateUserMapping: vi.fn(),
  listGroups: vi.fn(async () => ({ ok: true, data: [] })),
  rotateCredentials: vi.fn(async () => undefined),
  disableUser: vi.fn(async () => undefined),
  enableUser: vi.fn(async () => undefined),
  provisionUser: vi.fn<() => Promise<ProvisioningResult>>(
    async () => ({ status: "provisioned", mapping: {} }) as ProvisioningResult,
  ),
}));

vi.mock("$lib/server/auth", () => ({
  requireAdmin: mocks.requireAdmin,
}));

vi.mock("$lib/db/repositories/config", () => ({
  getConfig: mocks.getConfig,
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
  mocks.rotateCredentials.mockClear();
  mocks.disableUser.mockClear();
  mocks.enableUser.mockClear();
  mocks.provisionUser.mockClear();
}

function createActionEvent(body: FormData) {
  return {
    request: new Request("http://localhost/users", {
      method: "POST",
      body,
    }),
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
    });

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

    it("re-provisions in automatic mode (no initialPassword returned)", async () => {
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
      } as ProvisioningResult);

      const body = new FormData();
      body.set("id", "1");

      const result = await enableUserAction(
        createActionEvent(body) as unknown as Parameters<typeof enableUserAction>[0],
      );

      expect(result).toMatchObject({ success: true });
      expect(result).not.toHaveProperty("initialPassword");
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

    it("falls back to empty groupIds when dispatcharr_group_ids is invalid JSON", async () => {
      const { actions } = await import("./+page.server");
      const enableUserAction = actions.enableUser;
      if (!enableUserAction) throw new Error("enableUser action is undefined");

      mocks.getUserMappingById.mockReturnValueOnce(
        makeOrphanedMapping({ dispatcharr_group_ids: "not-valid-json" }),
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

  it("disables changeProfile because it cannot propagate to Dispatcharr", async () => {
    const { actions } = await import("./+page.server");
    const changeProfile = actions.changeProfile;
    if (!changeProfile) throw new Error("changeProfile action is undefined");

    const body = new FormData();
    body.set("id", "1");
    body.set("profile_id", "2");

    const result = await changeProfile(
      createActionEvent(body) as unknown as Parameters<typeof changeProfile>[0],
    );

    expect(result).toMatchObject({
      status: 400,
      data: {
        error:
          "Profile changes are currently unavailable because the Dispatcharr integration does not support propagating this update.",
      },
    });
    expect(mocks.requireAdmin).toHaveBeenCalledOnce();
    expect(mocks.getUserMappingById).not.toHaveBeenCalled();
    expect(mocks.updateUserMapping).not.toHaveBeenCalled();
  });
});
