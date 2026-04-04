// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => undefined),
  getConfig: vi.fn(async () => null as string | null),
  getAllUserMappings: vi.fn(() => []),
  getUserMappingById: vi.fn(
    () => null as { id: number; dispatcharr_user_id: number | null } | null,
  ),
  updateUserMapping: vi.fn(),
  listGroups: vi.fn(async () => ({ ok: true, data: [] })),
  updateUser: vi.fn(
    async () =>
      ({ ok: true, data: {} }) as
        | { ok: true; data: Record<string, unknown> }
        | { ok: false; error: string; message: string },
  ),
  rotateCredentials: vi.fn(async () => undefined),
  disableUser: vi.fn(async () => undefined),
  enableUser: vi.fn(async () => undefined),
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

vi.mock("$lib/dispatcharr/endpoints/users", () => ({
  updateUser: mocks.updateUser,
}));

vi.mock("$lib/bridge/lifecycle", () => ({
  rotateCredentials: mocks.rotateCredentials,
  disableUser: mocks.disableUser,
  enableUser: mocks.enableUser,
}));

function resetMocks() {
  mocks.requireAdmin.mockClear();
  mocks.getConfig.mockClear();
  mocks.getAllUserMappings.mockClear();
  mocks.getUserMappingById.mockClear();
  mocks.updateUserMapping.mockClear();
  mocks.listGroups.mockClear();
  mocks.updateUser.mockClear();
  mocks.rotateCredentials.mockClear();
  mocks.disableUser.mockClear();
  mocks.enableUser.mockClear();
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

  it("cleans up stale mapping on changeGroup when Dispatcharr returns not_found", async () => {
    const { actions } = await import("./+page.server");
    const changeGroup = actions.changeGroup;
    if (!changeGroup) throw new Error("changeGroup action is undefined");

    mocks.getUserMappingById.mockReturnValueOnce({
      id: 1,
      dispatcharr_user_id: 42,
    });
    mocks.getConfig.mockResolvedValueOnce("https://dispatch.example.com");
    mocks.getConfig.mockResolvedValueOnce("test-api-key");
    mocks.updateUser.mockResolvedValueOnce({
      ok: false,
      error: "not_found",
      message: "Not Found",
    });

    const body = new FormData();
    body.set("id", "1");
    body.set("group_ids", JSON.stringify([5, 7]));

    const result = await changeGroup(
      createActionEvent(body) as unknown as Parameters<typeof changeGroup>[0],
    );

    expect(result).toMatchObject({
      success: true,
      staleMappingCleared: true,
      message: "Dispatcharr user no longer exists. Cleared stale mapping and saved groups locally.",
    });
    expect(mocks.updateUserMapping).toHaveBeenCalledWith(1, {
      is_active: 0,
      dispatcharr_user_id: null,
      dispatcharr_username: null,
      dispatcharr_xc_password_enc: null,
      dispatcharr_group_ids: JSON.stringify([5, 7]),
    });
    expect(mocks.requireAdmin).toHaveBeenCalledOnce();
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
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.updateUserMapping).not.toHaveBeenCalled();
  });
});
