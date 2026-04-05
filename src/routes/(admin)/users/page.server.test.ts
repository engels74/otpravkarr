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
