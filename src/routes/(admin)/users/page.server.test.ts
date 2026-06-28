// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProvisioningRequest, ProvisioningResult } from "$lib/bridge/types";
import type { UserMapping } from "$lib/db/types";
import type { DispatcharrClient } from "$lib/dispatcharr/client";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => ({ id: 1, username: "admin" })),
  getConfig: vi.fn(async () => null as string | null),
  getAllUserMappings: vi.fn(() => [] as UserMapping[]),
  getUserMappingById: vi.fn(
    () => null as { id: number; dispatcharr_user_id: number | null } | null,
  ),
  tryResolveConfiguredPlexOwnerAccountId: vi.fn(async () => null as number | null),
  updateUserMapping: vi.fn(),
  deleteUserMapping: vi.fn(() => true),
  deleteUserSessionsByUserRef: vi.fn(() => 0),
  transaction: vi.fn((fn: () => unknown) => fn),
  listGroups: vi.fn(async () => ({ ok: true, data: [] })),
  listChannelGroups: vi.fn(async () => ({ ok: true, data: [] as { id: number; name: string }[] })),
  applyGroupSubscription: vi.fn(async () => ({
    ok: true,
    data: { profileIds: [10], groupIds: [5, 7] },
  })),
  listProfiles: vi.fn(async () => ({ ok: true, data: [] })),
  updateUser: vi.fn(async () => ({ ok: true, data: {} })),
  rotateCredentialsForMappingId: vi.fn(async () => undefined),
  disableUser: vi.fn(async () => undefined),
  enableUser: vi.fn(async () => undefined),
  provisionUser: vi.fn<() => Promise<ProvisioningResult>>(
    async () => ({ status: "provisioned", mapping: {} }) as ProvisioningResult,
  ),
  appendAuditLog: vi.fn(),
  getAccount: vi.fn(async () => ({
    id: 99999,
    uuid: "owner-uuid",
    username: "engels74",
    email: "owner@example.com",
    thumb: "",
  })),
}));

vi.mock("$lib/plex/client", () => ({
  getAccount: mocks.getAccount,
}));

vi.mock("$lib/dispatcharr/endpoints/channel-groups", () => ({
  listChannelGroups: mocks.listChannelGroups,
}));

vi.mock("$lib/bridge/subscriptions", () => ({
  applyGroupSubscription: mocks.applyGroupSubscription,
}));

vi.mock("$lib/server/auth", () => ({
  requireAdmin: mocks.requireAdmin,
}));

vi.mock("$lib/server/plex-owner", () => ({
  tryResolveConfiguredPlexOwnerAccountId: mocks.tryResolveConfiguredPlexOwnerAccountId,
  excludePlexOwnerMappings: <T extends { plex_account_id: number }>(
    mappings: T[],
    ownerPlexAccountId: number | null,
  ) =>
    ownerPlexAccountId == null
      ? mappings
      : mappings.filter((mapping) => mapping.plex_account_id !== ownerPlexAccountId),
  excludePlexOwnerNonSubscriberMappings: <T extends { plex_account_id: number; is_owner: number }>(
    mappings: T[],
    ownerPlexAccountId: number | null,
  ) =>
    ownerPlexAccountId == null
      ? mappings
      : mappings.filter(
          (mapping) => mapping.plex_account_id !== ownerPlexAccountId || mapping.is_owner === 1,
        ),
}));

vi.mock("$lib/db/connection", () => ({
  db: {
    transaction: mocks.transaction,
  },
}));

vi.mock("$lib/db/repositories/config", () => ({
  getConfig: mocks.getConfig,
}));

vi.mock("$lib/db/repositories/audit", () => ({
  appendAuditLog: mocks.appendAuditLog,
}));

vi.mock("$lib/db/repositories/users", () => ({
  deleteUserMapping: mocks.deleteUserMapping,
  getAllUserMappings: mocks.getAllUserMappings,
  getUserMappingById: mocks.getUserMappingById,
  updateUserMapping: mocks.updateUserMapping,
}));

vi.mock("$lib/db/repositories/sessions", () => ({
  deleteUserSessionsByUserRef: mocks.deleteUserSessionsByUserRef,
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
  rotateCredentialsForMappingId: mocks.rotateCredentialsForMappingId,
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
  mocks.tryResolveConfiguredPlexOwnerAccountId.mockClear();
  mocks.tryResolveConfiguredPlexOwnerAccountId.mockResolvedValue(null);
  mocks.updateUserMapping.mockClear();
  mocks.deleteUserMapping.mockClear();
  mocks.deleteUserMapping.mockReturnValue(true);
  mocks.deleteUserSessionsByUserRef.mockClear();
  mocks.deleteUserSessionsByUserRef.mockReturnValue(0);
  mocks.transaction.mockClear();
  mocks.transaction.mockImplementation((fn: () => unknown) => fn);
  mocks.listGroups.mockClear();
  mocks.listChannelGroups.mockClear();
  mocks.applyGroupSubscription.mockClear();
  mocks.applyGroupSubscription.mockResolvedValue({
    ok: true,
    data: { profileIds: [10], groupIds: [5, 7] },
  });
  mocks.listProfiles.mockClear();
  mocks.updateUser.mockClear();
  mocks.rotateCredentialsForMappingId.mockClear();
  mocks.disableUser.mockClear();
  mocks.enableUser.mockClear();
  mocks.provisionUser.mockClear();
  mocks.provisionUser.mockResolvedValue({
    status: "provisioned",
    mapping: {},
  } as ProvisioningResult);
  mocks.getAccount.mockClear();
  mocks.getAccount.mockResolvedValue({
    id: 99999,
    uuid: "owner-uuid",
    username: "engels74",
    email: "owner@example.com",
    thumb: "",
  });
  mocks.appendAuditLog.mockClear();
  mocks.appendAuditLog.mockImplementation(() => undefined);
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

function createLoadEvent(search = "") {
  return {
    url: new URL(`http://localhost/users${search}`),
  };
}

describe("admin users actions", () => {
  beforeEach(() => {
    resetMocks();
  });

  describe("load", () => {
    function makeMapping(overrides?: Record<string, unknown>) {
      return {
        id: 1,
        plex_account_id: 100,
        plex_uuid: "plex-uuid",
        plex_username: "regular-user",
        plex_email: "regular@example.com",
        plex_thumb: null,
        dispatcharr_user_id: 42,
        dispatcharr_username: "regular-user",
        dispatcharr_xc_password_enc: "encrypted",
        dispatcharr_group_ids: "[]",
        dispatcharr_profile_id: null,
        provisioning_mode: "automatic",
        is_active: 1,
        created_at: "2025-01-01 00:00:00",
        updated_at: "2025-01-01 00:00:00",
        last_synced_at: null,
        last_accessed_at: null,
        ...overrides,
      } as UserMapping;
    }

    it("excludes a duplicate Plex-owner mapping from the users table data", async () => {
      const { load } = await import("./+page.server");
      mocks.tryResolveConfiguredPlexOwnerAccountId.mockResolvedValueOnce(999);
      mocks.getAllUserMappings.mockReturnValueOnce([
        makeMapping({ id: 1, plex_account_id: 999, plex_username: "plex-owner" }),
        makeMapping({ id: 2, plex_account_id: 100, plex_username: "regular-user" }),
      ]);

      const result = (await load(createLoadEvent() as unknown as Parameters<typeof load>[0])) as {
        mappings: UserMapping[];
      };

      expect(result.mappings).toHaveLength(1);
      expect(result.mappings[0]?.plex_username).toBe("regular-user");
      expect(mocks.requireAdmin).toHaveBeenCalledOnce();
    });

    it("preserves normal filtering for regular mapped users", async () => {
      const { load } = await import("./+page.server");
      mocks.tryResolveConfiguredPlexOwnerAccountId.mockResolvedValueOnce(999);
      mocks.getAllUserMappings.mockReturnValueOnce([
        makeMapping({ id: 1, plex_account_id: 999, plex_username: "plex-owner" }),
        makeMapping({ id: 2, plex_account_id: 100, plex_username: "active-user" }),
        makeMapping({
          id: 3,
          plex_account_id: 101,
          plex_username: "inactive-user",
          dispatcharr_user_id: null,
          is_active: 0,
        }),
      ]);

      const result = (await load(
        createLoadEvent("?status=active&search=active") as unknown as Parameters<typeof load>[0],
      )) as {
        mappings: UserMapping[];
        filters: { status: string; mode: string; search: string };
      };

      expect(result.mappings).toHaveLength(1);
      expect(result.mappings[0]?.plex_username).toBe("active-user");
      expect(result.filters).toEqual({ status: "active", mode: "all", search: "active" });
    });
  });

  it("enforces the subscription via applyGroupSubscription on changeGroup", async () => {
    const { actions } = await import("./+page.server");
    const changeGroup = actions.changeGroup;
    if (!changeGroup) throw new Error("changeGroup action is undefined");

    mocks.getConfig.mockResolvedValue("https://dispatcharr.example");
    mocks.getUserMappingById.mockReturnValueOnce({
      id: 1,
      dispatcharr_user_id: 42,
      dispatcharr_group_ids: JSON.stringify([2]),
      plex_username: "alice",
    } as unknown as { id: number; dispatcharr_user_id: number | null });

    // changeGroup validates submitted ids against the live, non-quarantine group
    // list before enforcing, so 5 and 7 must exist as offerable groups.
    mocks.listChannelGroups.mockResolvedValueOnce({
      ok: true,
      data: [
        { id: 5, name: "Sports" },
        { id: 7, name: "News" },
      ],
    });

    const body = new FormData();
    body.set("id", "1");
    body.set("group_ids", JSON.stringify([5, 7]));

    const result = await changeGroup(
      createActionEvent(body) as unknown as Parameters<typeof changeGroup>[0],
    );

    expect(result).toMatchObject({ success: true });
    // The single enforcement path is used (it persists group ids + audits).
    expect(mocks.applyGroupSubscription).toHaveBeenCalledWith(expect.anything(), 1, [5, 7], {
      actor: "admin",
      ipAddress: "127.0.0.1",
    });
    expect(mocks.requireAdmin).toHaveBeenCalledOnce();
  });

  it("fails changeGroup for a mapping without a Dispatcharr account", async () => {
    const { actions } = await import("./+page.server");
    const changeGroup = actions.changeGroup;
    if (!changeGroup) throw new Error("changeGroup action is undefined");

    mocks.getUserMappingById.mockReturnValueOnce({
      id: 1,
      dispatcharr_user_id: null,
      dispatcharr_group_ids: "[]",
      plex_username: "alice",
    } as unknown as { id: number; dispatcharr_user_id: number | null });

    const body = new FormData();
    body.set("id", "1");
    body.set("group_ids", JSON.stringify([5]));

    const result = await changeGroup(
      createActionEvent(body) as unknown as Parameters<typeof changeGroup>[0],
    );

    expect(result).toMatchObject({ status: 400 });
    expect(mocks.applyGroupSubscription).not.toHaveBeenCalled();
  });

  it("toggles the per-user group lock via setGroupLock", async () => {
    const { actions } = await import("./+page.server");
    const setGroupLock = actions.setGroupLock;
    if (!setGroupLock) throw new Error("setGroupLock action is undefined");

    mocks.getUserMappingById.mockReturnValueOnce({
      id: 1,
      dispatcharr_user_id: 42,
      dispatcharr_group_ids: "[]",
      plex_username: "alice",
    } as unknown as { id: number; dispatcharr_user_id: number | null });

    const body = new FormData();
    body.set("id", "1");
    body.set("locked", "true");

    const result = await setGroupLock(
      createActionEvent(body) as unknown as Parameters<typeof setGroupLock>[0],
    );

    expect(result).toMatchObject({ success: true });
    expect(mocks.updateUserMapping).toHaveBeenCalledWith(1, { group_selection_locked: 1 });
    expect(mocks.appendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.lock_changed" }),
    );
  });

  it("provisions the owner as a non-admin subscriber via subscribeOwner", async () => {
    const { actions } = await import("./+page.server");
    const subscribeOwner = actions.subscribeOwner;
    if (!subscribeOwner) throw new Error("subscribeOwner action is undefined");

    mocks.getConfig.mockResolvedValue("https://dispatcharr.example");
    mocks.provisionUser.mockResolvedValue({
      status: "provisioned",
      mapping: { id: 7, dispatcharr_username: "engels74_2" },
      initialPassword: "owner-otp",
    } as unknown as ProvisioningResult);

    const result = await subscribeOwner(
      createActionEvent(new FormData()) as unknown as Parameters<typeof subscribeOwner>[0],
    );

    expect(mocks.getAccount).toHaveBeenCalled();
    expect(mocks.provisionUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ isOwner: true, mode: "automatic" }),
      expect.objectContaining({ actor: "admin" }),
    );
    expect(result).toMatchObject({ ownerSubscribed: true, initialPassword: "owner-otp" });
    expect(mocks.appendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.owner_subscribed" }),
    );
  });

  it("rejects subscribeOwner when the owner already has a subscriber account", async () => {
    const { actions } = await import("./+page.server");
    const subscribeOwner = actions.subscribeOwner;
    if (!subscribeOwner) throw new Error("missing");

    mocks.getConfig.mockResolvedValue("https://dispatcharr.example");
    mocks.provisionUser.mockResolvedValue({
      status: "already_exists",
      mapping: {},
    } as ProvisioningResult);

    const result = await subscribeOwner(
      createActionEvent(new FormData()) as unknown as Parameters<typeof subscribeOwner>[0],
    );

    expect(result).toMatchObject({ status: 400 });
  });

  describe("deleteMapping", () => {
    function makeDeletableMapping(overrides?: Record<string, unknown>) {
      return {
        id: 5,
        plex_account_id: 12345,
        plex_uuid: "abc-uuid",
        plex_username: "testuser",
        plex_email: "test@example.com",
        plex_thumb: null,
        dispatcharr_user_id: null,
        dispatcharr_username: null,
        dispatcharr_xc_password_enc: null,
        dispatcharr_group_ids: "[]",
        dispatcharr_profile_id: null,
        provisioning_mode: "automatic",
        is_active: 0,
        ...overrides,
      };
    }

    it("deletes an eligible local mapping, removes portal sessions, and writes audit", async () => {
      const { actions } = await import("./+page.server");
      const deleteMapping = actions.deleteMapping;
      if (!deleteMapping) throw new Error("deleteMapping action is undefined");

      mocks.getUserMappingById.mockReturnValueOnce(
        makeDeletableMapping({ id: 5, plex_username: "alice", provisioning_mode: "staff" }),
      );
      mocks.deleteUserSessionsByUserRef.mockReturnValueOnce(2);
      mocks.deleteUserMapping.mockReturnValueOnce(true);

      const body = new FormData();
      body.set("id", "5");

      const result = await deleteMapping(
        createActionEvent(body) as unknown as Parameters<typeof deleteMapping>[0],
      );

      expect(result).toMatchObject({ success: true });
      expect(mocks.transaction).toHaveBeenCalledTimes(1);
      expect(mocks.deleteUserSessionsByUserRef).toHaveBeenCalledWith("5");
      expect(mocks.deleteUserMapping).toHaveBeenCalledWith(5);
      expect(mocks.getConfig).not.toHaveBeenCalled();
      expect(mocks.updateUser).not.toHaveBeenCalled();
      expect(mocks.appendAuditLog).toHaveBeenCalledWith({
        actor: "admin",
        action: "user.mapping_deleted",
        detail: {
          mapping_id: 5,
          plex_username: "alice",
          plex_account_id: 12345,
          provisioning_mode: "staff",
          was_active: false,
        },
        ipAddress: "127.0.0.1",
      });
    });

    it("rejects mappings that still have a Dispatcharr account", async () => {
      const { actions } = await import("./+page.server");
      const deleteMapping = actions.deleteMapping;
      if (!deleteMapping) throw new Error("deleteMapping action is undefined");

      mocks.getUserMappingById.mockReturnValueOnce(
        makeDeletableMapping({
          dispatcharr_user_id: 42,
          dispatcharr_xc_password_enc: "encrypted",
          is_active: 1,
        }),
      );

      const body = new FormData();
      body.set("id", "5");

      const result = await deleteMapping(
        createActionEvent(body) as unknown as Parameters<typeof deleteMapping>[0],
      );

      expect(result).toMatchObject({
        status: 400,
        data: { error: "Disable the user before deleting the local mapping." },
      });
      expect(mocks.deleteUserSessionsByUserRef).not.toHaveBeenCalled();
      expect(mocks.deleteUserMapping).not.toHaveBeenCalled();
      expect(mocks.appendAuditLog).not.toHaveBeenCalled();
    });

    it("rejects mappings that still have a stored XC credential", async () => {
      const { actions } = await import("./+page.server");
      const deleteMapping = actions.deleteMapping;
      if (!deleteMapping) throw new Error("deleteMapping action is undefined");

      mocks.getUserMappingById.mockReturnValueOnce(
        makeDeletableMapping({ dispatcharr_xc_password_enc: "encrypted" }),
      );

      const body = new FormData();
      body.set("id", "5");

      const result = await deleteMapping(
        createActionEvent(body) as unknown as Parameters<typeof deleteMapping>[0],
      );

      expect(result).toMatchObject({
        status: 400,
        data: { error: "Disable the user before deleting the local mapping." },
      });
      expect(mocks.deleteUserSessionsByUserRef).not.toHaveBeenCalled();
      expect(mocks.deleteUserMapping).not.toHaveBeenCalled();
    });

    it("rejects missing id and missing mapping", async () => {
      const { actions } = await import("./+page.server");
      const deleteMapping = actions.deleteMapping;
      if (!deleteMapping) throw new Error("deleteMapping action is undefined");

      const missingIdResult = await deleteMapping(
        createActionEvent(new FormData()) as unknown as Parameters<typeof deleteMapping>[0],
      );
      expect(missingIdResult).toMatchObject({
        status: 400,
        data: { error: "Missing user mapping ID" },
      });
      expect(mocks.getUserMappingById).not.toHaveBeenCalled();

      const body = new FormData();
      body.set("id", "5");
      const missingMappingResult = await deleteMapping(
        createActionEvent(body) as unknown as Parameters<typeof deleteMapping>[0],
      );

      expect(missingMappingResult).toMatchObject({
        status: 400,
        data: { error: "User mapping not found" },
      });
      expect(mocks.deleteUserSessionsByUserRef).not.toHaveBeenCalled();
      expect(mocks.deleteUserMapping).not.toHaveBeenCalled();
    });

    it("rejects non-strict or unsafe id strings", async () => {
      const { actions } = await import("./+page.server");
      const deleteMapping = actions.deleteMapping;
      if (!deleteMapping) throw new Error("deleteMapping action is undefined");

      for (const submittedId of ["1e3", "5.0", "9007199254740993"]) {
        const body = new FormData();
        body.set("id", submittedId);

        const result = await deleteMapping(
          createActionEvent(body) as unknown as Parameters<typeof deleteMapping>[0],
        );

        expect(result).toMatchObject({
          status: 400,
          data: { error: "Missing user mapping ID" },
        });
      }

      expect(mocks.getUserMappingById).not.toHaveBeenCalled();
      expect(mocks.transaction).not.toHaveBeenCalled();
    });

    it("does not mask a successful delete when audit logging fails", async () => {
      const { actions } = await import("./+page.server");
      const deleteMapping = actions.deleteMapping;
      if (!deleteMapping) throw new Error("deleteMapping action is undefined");

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      mocks.getUserMappingById.mockReturnValueOnce(makeDeletableMapping());
      mocks.deleteUserMapping.mockReturnValueOnce(true);
      mocks.appendAuditLog.mockImplementationOnce(() => {
        throw new Error("audit unavailable");
      });

      const body = new FormData();
      body.set("id", "5");

      const result = await deleteMapping(
        createActionEvent(body) as unknown as Parameters<typeof deleteMapping>[0],
      );

      expect(result).toMatchObject({ success: true });
      expect(mocks.transaction).toHaveBeenCalledTimes(1);
      expect(mocks.deleteUserSessionsByUserRef).toHaveBeenCalledWith("5");
      expect(mocks.deleteUserMapping).toHaveBeenCalledWith(5);
      expect(warnSpy).toHaveBeenCalledWith(
        "Failed to append audit log for USER_MAPPING_DELETED: audit unavailable",
      );

      warnSpy.mockRestore();
    });

    it("fails inside the delete transaction when the mapping delete affects no rows", async () => {
      const { actions } = await import("./+page.server");
      const deleteMapping = actions.deleteMapping;
      if (!deleteMapping) throw new Error("deleteMapping action is undefined");

      mocks.getUserMappingById.mockReturnValueOnce(makeDeletableMapping());
      mocks.deleteUserSessionsByUserRef.mockReturnValueOnce(1);
      mocks.deleteUserMapping.mockReturnValueOnce(false);

      const body = new FormData();
      body.set("id", "5");

      const result = await deleteMapping(
        createActionEvent(body) as unknown as Parameters<typeof deleteMapping>[0],
      );

      expect(result).toMatchObject({
        status: 500,
        data: { error: "Failed to delete local mapping" },
      });
      expect(mocks.transaction).toHaveBeenCalledTimes(1);
      expect(mocks.deleteUserSessionsByUserRef).toHaveBeenCalledWith("5");
      expect(mocks.deleteUserMapping).toHaveBeenCalledWith(5);
      expect(mocks.appendAuditLog).not.toHaveBeenCalled();
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
