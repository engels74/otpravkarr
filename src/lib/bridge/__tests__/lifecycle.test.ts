import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserMapping } from "$lib/db/types";
import { AuditAction } from "$lib/db/types";
import type { DispatcharrUser } from "$lib/dispatcharr/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("$lib/utils/retry", () => ({
  retryResult: async (fn: () => Promise<unknown>) => fn(),
  retryAsync: async (fn: () => Promise<unknown>) => fn(),
  isTransientResultError: (r: { error: string }) =>
    r.error === "network_error" || r.error === "server_error",
  isTransientPlexError: () => true,
}));

const mockUpdateUser = vi.fn();
const mockGetUser = vi.fn();
vi.mock("$lib/dispatcharr/endpoints/users", () => ({
  updateUser: (...args: unknown[]) => mockUpdateUser(...args),
  getUser: (...args: unknown[]) => mockGetUser(...args),
}));

const mockGetAllUserMappings = vi.fn();
const mockUpdateUserMapping = vi.fn();
const mockMarkMappingInactive = vi.fn();
const mockUpdateLastSynced = vi.fn();
const mockUpdatePlexIdentity = vi.fn();
vi.mock("$lib/db/repositories/users", () => ({
  getAllUserMappings: (...args: unknown[]) => mockGetAllUserMappings(...args),
  updateUserMapping: (...args: unknown[]) => mockUpdateUserMapping(...args),
  markMappingInactive: (...args: unknown[]) => mockMarkMappingInactive(...args),
  updateLastSynced: (...args: unknown[]) => mockUpdateLastSynced(...args),
  updatePlexIdentity: (...args: unknown[]) => mockUpdatePlexIdentity(...args),
}));

const mockAppendAuditLog = vi.fn();
vi.mock("$lib/db/repositories/audit", () => ({
  appendAuditLog: (...args: unknown[]) => mockAppendAuditLog(...args),
}));

const mockGenerateXcPassword = vi.fn().mockReturnValue("new-xc-password");
vi.mock("$lib/crypto/passwords", () => ({
  generateXcPassword: (...args: unknown[]) => mockGenerateXcPassword(...args),
}));

const mockEncrypt = vi.fn().mockResolvedValue("encrypted:value");
vi.mock("$lib/crypto/encryption", () => ({
  encrypt: (...args: unknown[]) => mockEncrypt(...args),
}));

const mockGetAccount = vi.fn();
vi.mock("$lib/plex/client", () => ({
  getAccount: (...args: unknown[]) => mockGetAccount(...args),
}));

const mockFetchFriends = vi.fn();
vi.mock("$lib/plex/friends", () => ({
  fetchFriends: (...args: unknown[]) => mockFetchFriends(...args),
}));

// Import after mocks
const { rotateCredentials, disableUser, enableUser, reconcileSync } = await import("../lifecycle");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockClient = { baseUrl: "http://test", apiKey: "key" } as any;

function makeMapping(overrides: Partial<UserMapping> = {}): UserMapping {
  return {
    id: 1,
    plex_account_id: 100,
    plex_uuid: "plex-uuid-100",
    plex_username: "plexuser",
    plex_email: "plex@example.com",
    plex_thumb: "https://plex.tv/thumb.jpg",
    dispatcharr_user_id: 10,
    dispatcharr_username: "dispuser",
    dispatcharr_xc_password_enc: "encrypted:old",
    dispatcharr_group_ids: "[1,2]",
    dispatcharr_profile_id: null,
    provisioning_mode: "automatic",
    is_active: 1,
    created_at: "2025-01-01 00:00:00",
    updated_at: "2025-01-01 00:00:00",
    last_synced_at: null,
    last_accessed_at: null,
    ...overrides,
  };
}

function makeDispatcharrUser(overrides: Partial<DispatcharrUser> = {}): DispatcharrUser {
  return {
    id: 10,
    username: "dispuser",
    is_staff: false,
    is_active: true,
    groups: [1, 2],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateXcPassword.mockReturnValue("new-xc-password");
  mockEncrypt.mockResolvedValue("encrypted:value");
});

// ---------------------------------------------------------------------------
// rotateCredentials
// ---------------------------------------------------------------------------

describe("rotateCredentials", () => {
  it("generates new password, sends to Dispatcharr, encrypts, updates DB", async () => {
    const mapping = makeMapping();
    mockUpdateUser.mockResolvedValueOnce({ ok: true, data: makeDispatcharrUser() });

    await rotateCredentials(mockClient, mapping);

    expect(mockGenerateXcPassword).toHaveBeenCalledOnce();
    expect(mockUpdateUser).toHaveBeenCalledWith(mockClient, 10, {
      password: "new-xc-password",
    });
    expect(mockEncrypt).toHaveBeenCalledWith("new-xc-password", "credential-encryption");
    expect(mockUpdateUserMapping).toHaveBeenCalledWith(1, {
      dispatcharr_xc_password_enc: "encrypted:value",
    });
  });

  it("writes audit log entry with correct action", async () => {
    const mapping = makeMapping();
    mockUpdateUser.mockResolvedValueOnce({ ok: true, data: makeDispatcharrUser() });

    await rotateCredentials(mockClient, mapping);

    expect(mockAppendAuditLog).toHaveBeenCalledWith({
      action: AuditAction.USER_CREDENTIALS_ROTATED,
      detail: {
        mapping_id: 1,
        dispatcharr_username: "dispuser",
      },
    });
  });

  it("throws when Dispatcharr update fails", async () => {
    const mapping = makeMapping();
    mockUpdateUser.mockResolvedValueOnce({
      ok: false,
      error: "auth_failure",
      message: "Unauthorized",
    });

    await expect(rotateCredentials(mockClient, mapping)).rejects.toThrow(
      "Failed to rotate credentials on Dispatcharr: Unauthorized",
    );

    // DB and audit should NOT have been called
    expect(mockUpdateUserMapping).not.toHaveBeenCalled();
    expect(mockAppendAuditLog).not.toHaveBeenCalled();
  });

  it("throws for self_managed provisioning mode", async () => {
    const mapping = makeMapping({ provisioning_mode: "self_managed" });

    await expect(rotateCredentials(mockClient, mapping)).rejects.toThrow(
      "Cannot rotate credentials for non-automatic user (mode: self_managed)",
    );

    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(mockUpdateUserMapping).not.toHaveBeenCalled();
    expect(mockAppendAuditLog).not.toHaveBeenCalled();
  });

  it("throws for staff provisioning mode", async () => {
    const mapping = makeMapping({ provisioning_mode: "staff" });

    await expect(rotateCredentials(mockClient, mapping)).rejects.toThrow(
      "Cannot rotate credentials for non-automatic user (mode: staff)",
    );

    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(mockUpdateUserMapping).not.toHaveBeenCalled();
    expect(mockAppendAuditLog).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// disableUser
// ---------------------------------------------------------------------------

describe("disableUser", () => {
  it("sends is_active: false to Dispatcharr, marks local mapping inactive, writes audit", async () => {
    const mapping = makeMapping();
    mockUpdateUser.mockResolvedValueOnce({
      ok: true,
      data: makeDispatcharrUser({ is_active: false }),
    });

    await disableUser(mockClient, mapping);

    expect(mockUpdateUser).toHaveBeenCalledWith(mockClient, 10, { is_active: false });
    expect(mockMarkMappingInactive).toHaveBeenCalledWith(1);
    expect(mockAppendAuditLog).toHaveBeenCalledWith({
      action: AuditAction.USER_DISABLED,
      detail: {
        mapping_id: 1,
        dispatcharr_username: "dispuser",
      },
    });
  });

  it("throws when Dispatcharr update fails with non-not_found error", async () => {
    const mapping = makeMapping();
    mockUpdateUser.mockResolvedValueOnce({
      ok: false,
      error: "server_error",
      message: "Internal Server Error",
    });

    await expect(disableUser(mockClient, mapping)).rejects.toThrow(
      "Failed to disable user on Dispatcharr: Internal Server Error",
    );

    expect(mockMarkMappingInactive).not.toHaveBeenCalled();
    expect(mockAppendAuditLog).not.toHaveBeenCalled();
  });

  it("clears stale Dispatcharr fields on not_found instead of throwing", async () => {
    const mapping = makeMapping();
    mockUpdateUser.mockResolvedValueOnce({
      ok: false,
      error: "not_found",
      message: "Not Found",
    });

    await disableUser(mockClient, mapping);

    expect(mockUpdateUserMapping).toHaveBeenCalledWith(1, {
      is_active: 0,
      dispatcharr_user_id: null,
      dispatcharr_username: null,
      dispatcharr_xc_password_enc: null,
    });
    // Should NOT call markMappingInactive or appendAuditLog
    expect(mockMarkMappingInactive).not.toHaveBeenCalled();
    expect(mockAppendAuditLog).not.toHaveBeenCalled();
  });

  it("skips audit log when mapping is already inactive (idempotent re-disable)", async () => {
    const mapping = makeMapping({ is_active: 0 });
    mockUpdateUser.mockResolvedValueOnce({
      ok: true,
      data: makeDispatcharrUser({ is_active: false }),
    });

    await disableUser(mockClient, mapping);

    expect(mockUpdateUser).toHaveBeenCalledWith(mockClient, 10, { is_active: false });
    expect(mockMarkMappingInactive).toHaveBeenCalledWith(1);
    // Audit should NOT fire for re-disable
    expect(mockAppendAuditLog).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// enableUser
// ---------------------------------------------------------------------------

describe("enableUser", () => {
  it("sends is_active: true to Dispatcharr, updates local mapping", async () => {
    const mapping = makeMapping({ is_active: 0 });
    mockUpdateUser.mockResolvedValueOnce({
      ok: true,
      data: makeDispatcharrUser({ is_active: true }),
    });

    await enableUser(mockClient, mapping);

    expect(mockUpdateUser).toHaveBeenCalledWith(mockClient, 10, { is_active: true });
    expect(mockUpdateUserMapping).toHaveBeenCalledWith(1, { is_active: 1 });
  });

  it("throws when Dispatcharr update fails", async () => {
    const mapping = makeMapping({ is_active: 0 });
    mockUpdateUser.mockResolvedValueOnce({
      ok: false,
      error: "network_error",
      message: "Connection refused",
    });

    await expect(enableUser(mockClient, mapping)).rejects.toThrow(
      "Failed to enable user on Dispatcharr: Connection refused",
    );

    expect(mockUpdateUserMapping).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// reconcileSync
// ---------------------------------------------------------------------------

describe("reconcileSync", () => {
  const mockAccount = { query: vi.fn() } as any;

  beforeEach(() => {
    mockGetAccount.mockResolvedValue(mockAccount);
  });

  it("disables users removed from Plex friends", async () => {
    const mapping = makeMapping({ plex_account_id: 100, dispatcharr_user_id: 10 });
    mockFetchFriends.mockResolvedValueOnce([
      // friend with id 200 — mapping's plex_account_id 100 is absent
      { id: 200, email: "other@example.com", status: "accepted" },
    ]);
    mockGetAllUserMappings.mockReturnValueOnce([mapping]);
    mockUpdateUser.mockResolvedValueOnce({
      ok: true,
      data: makeDispatcharrUser({ is_active: false }),
    });

    const report = await reconcileSync(mockClient, "admin-token");

    expect(report.disabled).toBe(1);
    expect(mockUpdateUser).toHaveBeenCalledWith(mockClient, 10, { is_active: false });
    expect(mockMarkMappingInactive).toHaveBeenCalledWith(1);
  });

  it("deactivates locally without Dispatcharr call when dispatcharr_user_id is null and friend removed", async () => {
    const mapping = makeMapping({
      plex_account_id: 100,
      dispatcharr_user_id: null,
      is_active: 1,
    });
    mockFetchFriends.mockResolvedValueOnce([
      { id: 200, email: "other@example.com", status: "accepted" },
    ]);
    mockGetAllUserMappings.mockReturnValueOnce([mapping]);

    const report = await reconcileSync(mockClient, "admin-token");

    expect(report.disabled).toBe(1);
    // Should NOT call Dispatcharr API
    expect(mockUpdateUser).not.toHaveBeenCalled();
    // Should deactivate and clear stale credential fields
    expect(mockUpdateUserMapping).toHaveBeenCalledWith(1, {
      is_active: 0,
      dispatcharr_username: null,
      dispatcharr_xc_password_enc: null,
    });
    // Should write audit log
    expect(mockAppendAuditLog).toHaveBeenCalledWith({
      action: AuditAction.USER_DISABLED,
      detail: {
        mapping_id: 1,
        dispatcharr_username: "dispuser",
        reason: "plex_friend_removed_no_dispatcharr_user",
      },
    });
  });

  it("disables Dispatcharr user even when local mapping is inactive (handles drift)", async () => {
    const mapping = makeMapping({
      plex_account_id: 100,
      dispatcharr_user_id: 10,
      is_active: 0,
    });
    mockFetchFriends.mockResolvedValueOnce([]);
    mockGetAllUserMappings.mockReturnValueOnce([mapping]);
    mockUpdateUser.mockResolvedValueOnce({
      ok: true,
      data: makeDispatcharrUser({ is_active: false }),
    });

    const report = await reconcileSync(mockClient, "admin-token");

    // Should still call Dispatcharr to handle potential drift
    expect(mockUpdateUser).toHaveBeenCalledWith(mockClient, 10, { is_active: false });
    expect(mockMarkMappingInactive).toHaveBeenCalledWith(1);
    // But report.disabled should NOT increment (already inactive — idempotent)
    expect(report.disabled).toBe(0);
  });

  it("handles not_found during disable of removed friend by clearing stale fields", async () => {
    const mapping = makeMapping({
      plex_account_id: 100,
      dispatcharr_user_id: 10,
      is_active: 1,
    });
    mockFetchFriends.mockResolvedValueOnce([]);
    mockGetAllUserMappings.mockReturnValueOnce([mapping]);
    mockUpdateUser.mockResolvedValueOnce({
      ok: false,
      error: "not_found",
      message: "Not Found",
    });

    const report = await reconcileSync(mockClient, "admin-token");

    // disableUser should handle not_found by clearing stale Dispatcharr fields
    expect(mockUpdateUserMapping).toHaveBeenCalledWith(1, {
      is_active: 0,
      dispatcharr_user_id: null,
      dispatcharr_username: null,
      dispatcharr_xc_password_enc: null,
    });
    // Should count as disabled (was active)
    expect(report.disabled).toBe(1);
    // No errors — not_found is handled gracefully
    expect(report.errors).toHaveLength(0);
  });

  it("skips already-inactive mappings without dispatcharr_user_id for removed friends", async () => {
    const mapping = makeMapping({
      plex_account_id: 100,
      dispatcharr_user_id: null,
      is_active: 0,
    });
    mockFetchFriends.mockResolvedValueOnce([]);
    mockGetAllUserMappings.mockReturnValueOnce([mapping]);

    const report = await reconcileSync(mockClient, "admin-token");

    expect(report.disabled).toBe(0);
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(mockUpdateUserMapping).not.toHaveBeenCalled();
  });

  it("counts new Plex friends not yet mapped", async () => {
    mockFetchFriends.mockResolvedValueOnce([
      { id: 100, email: "mapped@example.com", status: "accepted" },
      { id: 200, email: "new1@example.com", status: "accepted" },
      { id: 300, email: "new2@example.com", status: "accepted" },
    ]);
    const mapping = makeMapping({ plex_account_id: 100, dispatcharr_user_id: 10 });
    mockGetAllUserMappings.mockReturnValueOnce([mapping]);
    // getUser for the one mapping that's still a friend
    mockGetUser.mockResolvedValueOnce({ ok: true, data: makeDispatcharrUser() });

    const report = await reconcileSync(mockClient, "admin-token");

    expect(report.newFriends).toBe(2);
  });

  it("detects orphaned Dispatcharr users (404 on getUser)", async () => {
    const mapping = makeMapping({ plex_account_id: 100, dispatcharr_user_id: 10 });
    mockFetchFriends.mockResolvedValueOnce([
      { id: 100, email: "plex@example.com", status: "accepted" },
    ]);
    mockGetAllUserMappings.mockReturnValueOnce([mapping]);
    mockGetUser.mockResolvedValueOnce({
      ok: false,
      error: "not_found",
      message: "Not Found",
    });

    const report = await reconcileSync(mockClient, "admin-token");

    expect(report.orphaned).toBe(1);
    expect(mockUpdateUserMapping).toHaveBeenCalledWith(1, {
      is_active: 0,
      dispatcharr_user_id: null,
      dispatcharr_username: null,
      dispatcharr_xc_password_enc: null,
    });
  });

  it("refreshes Plex identity when username/email/thumb changed", async () => {
    const mapping = makeMapping({
      plex_account_id: 100,
      plex_username: "oldname",
      plex_email: "old@example.com",
      plex_thumb: "https://old-thumb.jpg",
      dispatcharr_user_id: null, // no dispatcharr user — skip verification
    });
    mockFetchFriends.mockResolvedValueOnce([
      {
        id: 100,
        username: "newname",
        email: "new@example.com",
        thumb: "https://new-thumb.jpg",
        status: "accepted",
      },
    ]);
    mockGetAllUserMappings.mockReturnValueOnce([mapping]);

    const report = await reconcileSync(mockClient, "admin-token");

    expect(report.refreshed).toBe(1);
    expect(mockUpdatePlexIdentity).toHaveBeenCalledWith(
      1,
      "newname",
      "new@example.com",
      "https://new-thumb.jpg",
    );
  });

  it("does not refresh identity when nothing changed", async () => {
    const mapping = makeMapping({
      plex_account_id: 100,
      plex_username: "plexuser",
      plex_email: "plex@example.com",
      plex_thumb: "https://plex.tv/thumb.jpg",
      dispatcharr_user_id: null,
    });
    mockFetchFriends.mockResolvedValueOnce([
      {
        id: 100,
        username: "plexuser",
        email: "plex@example.com",
        thumb: "https://plex.tv/thumb.jpg",
        status: "accepted",
      },
    ]);
    mockGetAllUserMappings.mockReturnValueOnce([mapping]);

    const report = await reconcileSync(mockClient, "admin-token");

    expect(report.refreshed).toBe(0);
    expect(mockUpdatePlexIdentity).not.toHaveBeenCalled();
  });

  it("reconciles group drift from Dispatcharr", async () => {
    const mapping = makeMapping({
      plex_account_id: 100,
      dispatcharr_user_id: 10,
      dispatcharr_group_ids: "[1,2]",
      is_active: 1,
    });
    mockFetchFriends.mockResolvedValueOnce([
      { id: 100, email: "plex@example.com", status: "accepted" },
    ]);
    mockGetAllUserMappings.mockReturnValueOnce([mapping]);
    // Remote has groups [1, 3] — different from local [1, 2]
    mockGetUser.mockResolvedValueOnce({
      ok: true,
      data: makeDispatcharrUser({ groups: [1, 3], is_active: true }),
    });

    const report = await reconcileSync(mockClient, "admin-token");

    expect(mockUpdateUserMapping).toHaveBeenCalledWith(1, {
      dispatcharr_group_ids: JSON.stringify([1, 3]),
      is_active: 1,
    });
    // No errors
    expect(report.errors).toHaveLength(0);
  });

  it("reconciles active status drift from Dispatcharr", async () => {
    const mapping = makeMapping({
      plex_account_id: 100,
      dispatcharr_user_id: 10,
      dispatcharr_group_ids: "[1,2]",
      is_active: 1,
    });
    mockFetchFriends.mockResolvedValueOnce([
      { id: 100, email: "plex@example.com", status: "accepted" },
    ]);
    mockGetAllUserMappings.mockReturnValueOnce([mapping]);
    // Remote says user is inactive but local says active
    mockGetUser.mockResolvedValueOnce({
      ok: true,
      data: makeDispatcharrUser({ groups: [1, 2], is_active: false }),
    });

    await reconcileSync(mockClient, "admin-token");

    expect(mockUpdateUserMapping).toHaveBeenCalledWith(1, {
      dispatcharr_group_ids: JSON.stringify([1, 2]),
      is_active: 0,
    });
  });

  it("updates last_synced_at for each processed mapping that is still a friend", async () => {
    const mapping1 = makeMapping({ id: 1, plex_account_id: 100, dispatcharr_user_id: null });
    const mapping2 = makeMapping({ id: 2, plex_account_id: 200, dispatcharr_user_id: null });
    mockFetchFriends.mockResolvedValueOnce([
      { id: 100, email: "a@example.com", status: "accepted" },
      { id: 200, email: "b@example.com", status: "accepted" },
    ]);
    mockGetAllUserMappings.mockReturnValueOnce([mapping1, mapping2]);

    await reconcileSync(mockClient, "admin-token");

    expect(mockUpdateLastSynced).toHaveBeenCalledWith(1);
    expect(mockUpdateLastSynced).toHaveBeenCalledWith(2);
    expect(mockUpdateLastSynced).toHaveBeenCalledTimes(2);
  });

  it("does not update last_synced_at for mappings removed from friends", async () => {
    const mapping = makeMapping({ plex_account_id: 100 });
    mockFetchFriends.mockResolvedValueOnce([]); // no friends
    mockGetAllUserMappings.mockReturnValueOnce([mapping]);
    mockUpdateUser.mockResolvedValueOnce({
      ok: true,
      data: makeDispatcharrUser({ is_active: false }),
    });

    await reconcileSync(mockClient, "admin-token");

    expect(mockUpdateLastSynced).not.toHaveBeenCalled();
  });

  it("returns accurate SyncReport with all counts", async () => {
    // mapping1: still a friend, identity changed, no dispatcharr user
    const mapping1 = makeMapping({
      id: 1,
      plex_account_id: 100,
      plex_username: "old",
      dispatcharr_user_id: null,
    });
    // mapping2: removed from friends, active
    const mapping2 = makeMapping({
      id: 2,
      plex_account_id: 200,
      dispatcharr_user_id: 20,
      is_active: 1,
    });
    // mapping3: still a friend, dispatcharr user orphaned (404)
    const mapping3 = makeMapping({
      id: 3,
      plex_account_id: 300,
      plex_username: "cuser",
      plex_email: "c@example.com",
      plex_thumb: null,
      dispatcharr_user_id: 30,
    });

    mockFetchFriends.mockResolvedValueOnce([
      { id: 100, username: "newname", email: "a@example.com", status: "accepted" },
      { id: 300, email: "c@example.com", status: "accepted" },
      { id: 400, email: "new@example.com", status: "accepted" }, // unmapped
    ]);
    mockGetAllUserMappings.mockReturnValueOnce([mapping1, mapping2, mapping3]);

    // mapping2 disable
    mockUpdateUser.mockResolvedValueOnce({
      ok: true,
      data: makeDispatcharrUser({ is_active: false }),
    });
    // mapping3 orphaned
    mockGetUser.mockResolvedValueOnce({
      ok: false,
      error: "not_found",
      message: "Not Found",
    });

    const report = await reconcileSync(mockClient, "admin-token");

    expect(report.refreshed).toBe(1); // mapping1 identity changed
    expect(report.disabled).toBe(1); // mapping2 removed from friends
    expect(report.orphaned).toBe(1); // mapping3 dispatcharr user gone
    expect(report.newFriends).toBe(1); // id=400 not in any mapping
    expect(report.errors).toHaveLength(0);
  });

  it("handles Plex fetch failure gracefully", async () => {
    mockGetAccount.mockRejectedValueOnce(new Error("Plex is down"));

    const report = await reconcileSync(mockClient, "admin-token");

    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toContain("Failed to fetch Plex friends");
    expect(report.errors[0]).toContain("Plex is down");
    // Should still write audit log
    expect(mockAppendAuditLog).toHaveBeenCalledWith({
      action: AuditAction.SYNC_COMPLETED,
      detail: expect.objectContaining({ errors: expect.any(Array) }),
    });
  });

  it("writes sync.completed audit log entry", async () => {
    mockFetchFriends.mockResolvedValueOnce([]);
    mockGetAllUserMappings.mockReturnValueOnce([]);

    await reconcileSync(mockClient, "admin-token");

    expect(mockAppendAuditLog).toHaveBeenCalledWith({
      action: AuditAction.SYNC_COMPLETED,
      detail: {
        newFriends: 0,
        disabled: 0,
        orphaned: 0,
        refreshed: 0,
        errors: [],
      },
    });
  });

  it("records error when getUser returns a non-not_found failure", async () => {
    const mapping = makeMapping({ plex_account_id: 100, dispatcharr_user_id: 10 });
    mockFetchFriends.mockResolvedValueOnce([
      { id: 100, email: "plex@example.com", status: "accepted" },
    ]);
    mockGetAllUserMappings.mockReturnValueOnce([mapping]);
    mockGetUser.mockResolvedValueOnce({
      ok: false,
      error: "auth_failure",
      message: "Bad API key",
    });

    const report = await reconcileSync(mockClient, "admin-token");

    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toContain("Failed to verify Dispatcharr user dispuser");
    expect(report.orphaned).toBe(0);
  });
});
