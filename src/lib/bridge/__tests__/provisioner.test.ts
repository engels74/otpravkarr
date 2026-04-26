// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserMapping } from "$lib/db/types";
import type { DispatcharrResult, DispatcharrUser } from "$lib/dispatcharr/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("$lib/db/repositories/users", () => ({
  getUserMappingByPlexId: vi.fn(),
  createUserMapping: vi.fn(),
  updateUserMapping: vi.fn(),
  getAllUserMappings: vi.fn(),
}));

vi.mock("$lib/db/repositories/audit", () => ({
  appendAuditLog: vi.fn(),
}));

vi.mock("$lib/dispatcharr/endpoints/users", () => ({
  createUser: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock("$lib/dispatcharr/pagination", () => ({
  fetchAllPages: vi.fn(),
}));

vi.mock("$lib/crypto/encryption", () => ({
  encrypt: vi.fn(async (plaintext: string, _purpose: string) => `encrypted:${plaintext}`),
  decrypt: vi.fn(async (ciphertext: string, _purpose: string) =>
    ciphertext.replace(/^encrypted:/, ""),
  ),
}));

vi.mock("$lib/crypto/passwords", () => ({
  generateXcPassword: vi.fn(() => "generated-password-24"),
}));

// Mock sleep to be instant so retryResult doesn't actually wait
vi.mock("$lib/utils/retry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/utils/retry")>();
  return {
    ...actual,
    sleep: vi.fn(async () => {}),
  };
});

// Import after mocks
const { getUserMappingByPlexId, createUserMapping, updateUserMapping, getAllUserMappings } =
  await import("$lib/db/repositories/users");
const { appendAuditLog } = await import("$lib/db/repositories/audit");
const { createUser, getUser, updateUser } = await import("$lib/dispatcharr/endpoints/users");
const { fetchAllPages } = await import("$lib/dispatcharr/pagination");
const { encrypt, decrypt } = await import("$lib/crypto/encryption");
const { generateXcPassword } = await import("$lib/crypto/passwords");
const { sanitizeUsername, provisionUser } = await import("../provisioner");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMapping(overrides: Partial<UserMapping> = {}): UserMapping {
  return {
    id: 1,
    plex_account_id: 12345,
    plex_uuid: "plex-uuid-abc",
    plex_username: "testuser",
    plex_email: "test@example.com",
    plex_thumb: "https://plex.tv/thumb.jpg",
    dispatcharr_user_id: 42,
    dispatcharr_username: "testuser",
    dispatcharr_xc_password_enc: "encrypted-blob",
    dispatcharr_group_ids: "[1,2]",
    dispatcharr_profile_id: 5,
    provisioning_mode: "automatic",
    is_active: 1,
    created_at: "2024-01-01 00:00:00",
    updated_at: "2024-01-01 00:00:00",
    last_synced_at: null,
    last_accessed_at: null,
    ...overrides,
  };
}

function makeDispatcharrUser(overrides: Partial<DispatcharrUser> = {}): DispatcharrUser {
  return {
    id: 42,
    username: "testuser",
    email: "test@example.com",
    is_staff: false,
    is_superuser: false,
    ...overrides,
  };
}

const mockClient = {} as import("$lib/dispatcharr/client").DispatcharrClient;

function makePlexIdentity(overrides: Partial<import("$lib/plex/types").PlexIdentity> = {}) {
  return {
    id: 12345,
    uuid: "plex-uuid-abc",
    username: "TestUser",
    email: "test@example.com",
    thumb: "https://plex.tv/thumb.jpg",
    authenticationToken: "plex-token",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.mocked(getUserMappingByPlexId).mockReset();
  vi.mocked(createUserMapping).mockReset();
  vi.mocked(updateUserMapping).mockReset();
  vi.mocked(getAllUserMappings).mockReset();
  vi.mocked(appendAuditLog).mockReset();
  vi.mocked(createUser).mockReset();
  vi.mocked(getUser).mockReset();
  vi.mocked(updateUser).mockReset();
  vi.mocked(fetchAllPages).mockReset();
  vi.mocked(encrypt)
    .mockReset()
    .mockImplementation(async (plaintext: string) => `encrypted:${plaintext}`);
  vi.mocked(decrypt)
    .mockReset()
    .mockImplementation(async (ciphertext: string) => ciphertext.replace(/^encrypted:/, ""));
  vi.mocked(generateXcPassword).mockReset().mockReturnValue("generated-password-24");

  // Default: no existing mappings
  vi.mocked(getUserMappingByPlexId).mockReturnValue(null);
  vi.mocked(getAllUserMappings).mockReturnValue([]);

  // Default: updateUser succeeds (reactivation re-asserts custom_properties.xc_password)
  vi.mocked(updateUser).mockResolvedValue({
    ok: true,
    data: makeDispatcharrUser(),
  } as DispatcharrResult<DispatcharrUser>);

  // Default: remote fetch fails (no client.baseUrl in mockClient), matching pre-existing behavior
  vi.mocked(fetchAllPages).mockResolvedValue({
    ok: false,
    error: "network_error" as const,
    message: "No baseUrl configured",
  });
});

// ---------------------------------------------------------------------------
// sanitizeUsername
// ---------------------------------------------------------------------------

describe("sanitizeUsername", () => {
  it("strips non-alphanumeric characters and lowercases", () => {
    expect(sanitizeUsername("Test-User_123!", [])).toBe("testuser123");
  });

  it("returns 'plexuser' when all characters are stripped", () => {
    expect(sanitizeUsername("---!!!---", [])).toBe("plexuser");
  });

  it("returns base name when no collision", () => {
    expect(sanitizeUsername("john", ["alice", "bob"])).toBe("john");
  });

  it("appends _2 suffix on first collision", () => {
    expect(sanitizeUsername("john", ["john"])).toBe("john_2");
  });

  it("increments suffix to find unique name", () => {
    expect(sanitizeUsername("john", ["john", "john_2", "john_3"])).toBe("john_4");
  });

  it("handles empty username by using plexuser", () => {
    expect(sanitizeUsername("", [])).toBe("plexuser");
  });

  it("handles plexuser collision", () => {
    expect(sanitizeUsername("", ["plexuser"])).toBe("plexuser_2");
  });

  it("detects collision case-insensitively", () => {
    expect(sanitizeUsername("John", ["JOHN"])).toBe("john_2");
  });

  it("detects suffixed collision case-insensitively", () => {
    expect(sanitizeUsername("John", ["John", "JOHN_2"])).toBe("john_3");
  });
});

// ---------------------------------------------------------------------------
// provisionUser — already_exists
// ---------------------------------------------------------------------------

describe("provisionUser — already_exists", () => {
  it("returns already_exists for active mapping", async () => {
    const existing = makeMapping({ is_active: 1 });
    vi.mocked(getUserMappingByPlexId).mockReturnValue(existing);

    const result = await provisionUser(mockClient, {
      plexIdentity: makePlexIdentity(),
      mode: "automatic",
      groupIds: [1, 2],
    });

    expect(result.status).toBe("already_exists");
    if (result.status === "already_exists") {
      expect(result.mapping).toBe(existing);
    }
    // Should NOT call any Dispatcharr endpoints
    expect(createUser).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// provisionUser — reactivation
// ---------------------------------------------------------------------------

describe("provisionUser — reactivation", () => {
  it("reactivates inactive mapping and re-asserts custom_properties.xc_password on Dispatcharr, merging existing keys", async () => {
    const inactive = makeMapping({
      is_active: 0,
      dispatcharr_user_id: 42,
      dispatcharr_xc_password_enc: "encrypted:legacy-password",
      provisioning_mode: "automatic",
    });
    const reactivated = makeMapping({ is_active: 1, dispatcharr_user_id: 42 });

    vi.mocked(getUserMappingByPlexId)
      .mockReturnValueOnce(inactive) // initial lookup
      .mockReturnValueOnce(reactivated); // re-read after update

    // Remote user already has an existing_key in custom_properties that must be preserved
    vi.mocked(getUser).mockResolvedValue({
      ok: true,
      data: makeDispatcharrUser({ custom_properties: { existing_key: "foo", xc_password: "old" } }),
    } as DispatcharrResult<DispatcharrUser>);

    const result = await provisionUser(mockClient, {
      plexIdentity: makePlexIdentity(),
      mode: "automatic",
      groupIds: [1, 2],
    });

    expect(result.status).toBe("reactivated");
    if (result.status === "reactivated") {
      expect(result.mapping.is_active).toBe(1);
    }
    expect(getUser).toHaveBeenCalledWith(mockClient, 42);
    // Stored password is decrypted and pushed to Dispatcharr — no churn, bookmarked URLs keep working
    expect(decrypt).toHaveBeenCalledWith("encrypted:legacy-password", "credential-encryption");
    // existing_key must be preserved; xc_password is updated (not replaced wholesale)
    expect(updateUser).toHaveBeenCalledWith(mockClient, 42, {
      custom_properties: { existing_key: "foo", xc_password: "legacy-password" },
    });
    expect(updateUserMapping).toHaveBeenCalledWith(inactive.id, { is_active: 1 });
    expect(appendAuditLog).toHaveBeenCalledWith({
      action: "user.provisioned",
      detail: { plex_username: "TestUser", reactivated: true },
    });
  });

  it("defaults custom_properties to {} when remote user has no custom_properties", async () => {
    const inactive = makeMapping({
      is_active: 0,
      dispatcharr_user_id: 42,
      dispatcharr_xc_password_enc: "encrypted:legacy-password",
      provisioning_mode: "automatic",
    });
    const reactivated = makeMapping({ is_active: 1, dispatcharr_user_id: 42 });

    vi.mocked(getUserMappingByPlexId)
      .mockReturnValueOnce(inactive)
      .mockReturnValueOnce(reactivated);

    // Remote user has no custom_properties field at all
    vi.mocked(getUser).mockResolvedValue({
      ok: true,
      data: makeDispatcharrUser(),
    } as DispatcharrResult<DispatcharrUser>);

    const result = await provisionUser(mockClient, {
      plexIdentity: makePlexIdentity(),
      mode: "automatic",
      groupIds: [1, 2],
    });

    expect(result.status).toBe("reactivated");
    expect(decrypt).toHaveBeenCalledWith("encrypted:legacy-password", "credential-encryption");
    // No existing keys — only xc_password should be in the PATCH
    expect(updateUser).toHaveBeenCalledWith(mockClient, 42, {
      custom_properties: { xc_password: "legacy-password" },
    });
  });

  it("skips remote xc_password refresh for self_managed reactivation (no local password)", async () => {
    const inactive = makeMapping({
      is_active: 0,
      dispatcharr_user_id: 42,
      dispatcharr_xc_password_enc: null,
      provisioning_mode: "self_managed",
    });
    const reactivated = makeMapping({ is_active: 1, dispatcharr_user_id: 42 });

    vi.mocked(getUserMappingByPlexId)
      .mockReturnValueOnce(inactive)
      .mockReturnValueOnce(reactivated);

    vi.mocked(getUser).mockResolvedValue({
      ok: true,
      data: makeDispatcharrUser(),
    } as DispatcharrResult<DispatcharrUser>);

    const result = await provisionUser(mockClient, {
      plexIdentity: makePlexIdentity(),
      mode: "self_managed",
      groupIds: [1, 2],
    });

    expect(result.status).toBe("reactivated");
    expect(updateUser).not.toHaveBeenCalled();
    expect(decrypt).not.toHaveBeenCalled();
    expect(updateUserMapping).toHaveBeenCalledWith(inactive.id, { is_active: 1 });
  });

  it("skips remote xc_password refresh for automatic mapping with null stored password", async () => {
    const inactive = makeMapping({
      is_active: 0,
      dispatcharr_user_id: 42,
      dispatcharr_xc_password_enc: null,
      provisioning_mode: "automatic",
    });
    const reactivated = makeMapping({ is_active: 1, dispatcharr_user_id: 42 });

    vi.mocked(getUserMappingByPlexId)
      .mockReturnValueOnce(inactive)
      .mockReturnValueOnce(reactivated);

    vi.mocked(getUser).mockResolvedValue({
      ok: true,
      data: makeDispatcharrUser(),
    } as DispatcharrResult<DispatcharrUser>);

    const result = await provisionUser(mockClient, {
      plexIdentity: makePlexIdentity(),
      mode: "automatic",
      groupIds: [1, 2],
    });

    expect(result.status).toBe("reactivated");
    expect(updateUser).not.toHaveBeenCalled();
    expect(decrypt).not.toHaveBeenCalled();
  });

  it("returns failed when decrypting the stored xc_password throws", async () => {
    const inactive = makeMapping({
      is_active: 0,
      dispatcharr_user_id: 42,
      dispatcharr_xc_password_enc: "encrypted:legacy-password",
      provisioning_mode: "automatic",
    });
    vi.mocked(getUserMappingByPlexId).mockReturnValue(inactive);

    vi.mocked(getUser).mockResolvedValue({
      ok: true,
      data: makeDispatcharrUser(),
    } as DispatcharrResult<DispatcharrUser>);

    vi.mocked(decrypt).mockRejectedValueOnce(new Error("authentication tag mismatch"));

    const result = await provisionUser(mockClient, {
      plexIdentity: makePlexIdentity(),
      mode: "automatic",
      groupIds: [1, 2],
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).toContain("Failed to decrypt stored xc_password");
    }
    expect(updateUser).not.toHaveBeenCalled();
    expect(updateUserMapping).not.toHaveBeenCalled();
  });

  it("returns failed when the remote xc_password PATCH fails", async () => {
    const inactive = makeMapping({
      is_active: 0,
      dispatcharr_user_id: 42,
      dispatcharr_xc_password_enc: "encrypted:legacy-password",
      provisioning_mode: "automatic",
    });
    vi.mocked(getUserMappingByPlexId).mockReturnValue(inactive);

    vi.mocked(getUser).mockResolvedValue({
      ok: true,
      data: makeDispatcharrUser(),
    } as DispatcharrResult<DispatcharrUser>);

    vi.mocked(updateUser).mockResolvedValueOnce({
      ok: false,
      error: "validation_error",
      message: "Dispatcharr rejected custom_properties update",
    } as DispatcharrResult<DispatcharrUser>);

    const result = await provisionUser(mockClient, {
      plexIdentity: makePlexIdentity(),
      mode: "automatic",
      groupIds: [1, 2],
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).toBe("Dispatcharr rejected custom_properties update");
    }
    // Must NOT flip is_active or audit before the remote refresh succeeds
    expect(updateUserMapping).not.toHaveBeenCalled();
    expect(appendAuditLog).not.toHaveBeenCalled();
  });

  it("returns failed when Dispatcharr getUser fails with non-not_found error", async () => {
    const inactive = makeMapping({ is_active: 0, dispatcharr_user_id: 42 });
    vi.mocked(getUserMappingByPlexId).mockReturnValue(inactive);

    vi.mocked(getUser).mockResolvedValue({
      ok: false,
      error: "validation_error",
      message: "User not found on Dispatcharr",
    } as DispatcharrResult<DispatcharrUser>);

    const result = await provisionUser(mockClient, {
      plexIdentity: makePlexIdentity(),
      mode: "automatic",
      groupIds: [1, 2],
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).toBe("User not found on Dispatcharr");
    }
    // Should NOT update local DB on non-not_found failure
    expect(updateUserMapping).not.toHaveBeenCalled();
  });

  it("falls through to create flow when reactivation returns not_found", async () => {
    const inactive = makeMapping({ is_active: 0, dispatcharr_user_id: 42 });
    const updatedMapping = makeMapping({
      id: 1,
      dispatcharr_user_id: 200,
      dispatcharr_username: "testuser",
      provisioning_mode: "automatic",
      is_active: 1,
    });

    vi.mocked(getUserMappingByPlexId)
      .mockReturnValueOnce(inactive) // initial lookup
      .mockReturnValueOnce(updatedMapping); // re-read after updateUserMapping in create flow

    // Reactivation verify fails with not_found (user deleted externally)
    vi.mocked(getUser).mockResolvedValue({
      ok: false,
      error: "not_found",
      message: "User not found",
    } as DispatcharrResult<DispatcharrUser>);

    // Create flow succeeds on Dispatcharr
    const dispatcharrUser = makeDispatcharrUser({ id: 200, username: "testuser" });
    vi.mocked(createUser).mockResolvedValue({ ok: true, data: dispatcharrUser });

    const result = await provisionUser(mockClient, {
      plexIdentity: makePlexIdentity(),
      mode: "automatic",
      groupIds: [1, 2],
    });

    // Should have cleared stale dispatcharr data first
    expect(updateUserMapping).toHaveBeenCalledWith(inactive.id, {
      dispatcharr_user_id: null,
      dispatcharr_username: null,
      dispatcharr_xc_password_enc: null,
    });

    // Should update existing mapping instead of creating a new one (avoids UNIQUE constraint)
    expect(updateUserMapping).toHaveBeenCalledWith(
      inactive.id,
      expect.objectContaining({
        dispatcharr_user_id: 200,
        dispatcharr_username: "testuser",
        is_active: 1,
      }),
    );
    expect(createUserMapping).not.toHaveBeenCalled();

    expect(result.status).toBe("provisioned");
    expect(createUser).toHaveBeenCalled();
    if (result.status === "provisioned") {
      expect(result.mapping.dispatcharr_user_id).toBe(200);
    }
  });

  it("falls through to create flow when inactive mapping has null dispatcharr_user_id", async () => {
    const inactive = makeMapping({ is_active: 0, dispatcharr_user_id: null });
    const updatedMapping = makeMapping({
      id: 1,
      dispatcharr_user_id: 300,
      dispatcharr_username: "testuser",
      provisioning_mode: "automatic",
      is_active: 1,
    });

    vi.mocked(getUserMappingByPlexId)
      .mockReturnValueOnce(inactive) // initial lookup
      .mockReturnValueOnce(updatedMapping); // re-read after updateUserMapping in create flow

    const dispatcharrUser = makeDispatcharrUser({ id: 300, username: "testuser" });
    vi.mocked(createUser).mockResolvedValue({ ok: true, data: dispatcharrUser });

    const result = await provisionUser(mockClient, {
      plexIdentity: makePlexIdentity(),
      mode: "automatic",
      groupIds: [1],
    });

    // Should skip reactivation entirely and go to create flow
    expect(getUser).not.toHaveBeenCalled();

    // Should update existing mapping instead of creating a new one (avoids UNIQUE constraint)
    expect(updateUserMapping).toHaveBeenCalledWith(
      inactive.id,
      expect.objectContaining({
        dispatcharr_user_id: 300,
        dispatcharr_username: "testuser",
        is_active: 1,
      }),
    );
    expect(createUserMapping).not.toHaveBeenCalled();

    expect(result.status).toBe("provisioned");
    expect(createUser).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// provisionUser — create (automatic mode)
// ---------------------------------------------------------------------------

describe("provisionUser — create (automatic mode)", () => {
  it("creates new user, encrypts password, stores mapping", async () => {
    const dispatcharrUser = makeDispatcharrUser({ id: 99, username: "testuser" });
    const newMapping = makeMapping({
      id: 5,
      dispatcharr_user_id: 99,
      dispatcharr_username: "testuser",
      dispatcharr_xc_password_enc: "encrypted:generated-password-24",
      provisioning_mode: "automatic",
    });

    vi.mocked(createUser).mockResolvedValue({ ok: true, data: dispatcharrUser });
    vi.mocked(createUserMapping).mockReturnValue(newMapping);

    const result = await provisionUser(mockClient, {
      plexIdentity: makePlexIdentity(),
      mode: "automatic",
      groupIds: [1, 2],
    });

    expect(result.status).toBe("provisioned");
    if (result.status === "provisioned") {
      expect(result.mapping.dispatcharr_user_id).toBe(99);
      // Automatic mode should NOT expose initialPassword (it's encrypted and stored)
      expect(result.initialPassword).toBeUndefined();
    }

    // Verify createUser was called with correct data (no is_active/groups — not in API)
    // is_staff is omitted for non-staff users to avoid sending unnecessary fields.
    // custom_properties.xc_password mirrors the Django password so Dispatcharr's
    // Xtream-Codes endpoints (/get.php, /player_api.php) authenticate correctly.
    expect(createUser).toHaveBeenCalledWith(mockClient, {
      username: "testuser",
      password: "generated-password-24",
      custom_properties: { xc_password: "generated-password-24" },
    });

    // Verify password was encrypted for automatic mode
    expect(encrypt).toHaveBeenCalledWith("generated-password-24", "credential-encryption");

    // Verify mapping was stored with encrypted password
    expect(createUserMapping).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatcharr_xc_password_enc: "encrypted:generated-password-24",
        provisioning_mode: "automatic",
      }),
    );

    // Verify audit log
    expect(appendAuditLog).toHaveBeenCalledWith({
      action: "user.provisioned",
      detail: {
        plex_username: "TestUser",
        dispatcharr_username: "testuser",
        mode: "automatic",
      },
    });
  });

  it("returns the initial password for automatic mode when explicitly requested", async () => {
    const dispatcharrUser = makeDispatcharrUser({ id: 100, username: "testuser" });
    const newMapping = makeMapping({
      id: 8,
      dispatcharr_user_id: 100,
      dispatcharr_username: "testuser",
      dispatcharr_xc_password_enc: "encrypted:generated-password-24",
      provisioning_mode: "automatic",
    });

    vi.mocked(createUser).mockResolvedValue({ ok: true, data: dispatcharrUser });
    vi.mocked(createUserMapping).mockReturnValue(newMapping);

    const result = await provisionUser(mockClient, {
      plexIdentity: makePlexIdentity(),
      mode: "automatic",
      groupIds: [1, 2],
      exposeInitialPassword: true,
    });

    expect(result.status).toBe("provisioned");
    if (result.status === "provisioned") {
      expect(result.initialPassword).toBe("generated-password-24");
    }
    expect(encrypt).toHaveBeenCalledWith("generated-password-24", "credential-encryption");
  });
});

// ---------------------------------------------------------------------------
// provisionUser — create (self_managed mode)
// ---------------------------------------------------------------------------

describe("provisionUser — create (self_managed mode)", () => {
  it("creates user without storing encrypted password", async () => {
    const dispatcharrUser = makeDispatcharrUser({ id: 77 });
    const newMapping = makeMapping({
      id: 6,
      dispatcharr_user_id: 77,
      dispatcharr_xc_password_enc: null,
      provisioning_mode: "self_managed",
    });

    vi.mocked(createUser).mockResolvedValue({ ok: true, data: dispatcharrUser });
    vi.mocked(createUserMapping).mockReturnValue(newMapping);

    const result = await provisionUser(mockClient, {
      plexIdentity: makePlexIdentity(),
      mode: "self_managed",
      groupIds: [3],
    });

    expect(result.status).toBe("provisioned");
    if (result.status === "provisioned") {
      // Self-managed mode surfaces the one-time password for admin onboarding
      expect(result.initialPassword).toBe("generated-password-24");
    }

    // Password should NOT be encrypted for self_managed
    expect(encrypt).not.toHaveBeenCalled();

    // Mapping should have null encrypted password
    expect(createUserMapping).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatcharr_xc_password_enc: null,
        provisioning_mode: "self_managed",
      }),
    );

    // is_staff should be omitted for non-staff users; xc_password is set so
    // /get.php authenticates even when the Django password is admin-reset later.
    expect(createUser).toHaveBeenCalledWith(mockClient, {
      username: "testuser",
      password: "generated-password-24",
      custom_properties: { xc_password: "generated-password-24" },
    });
  });
});

// ---------------------------------------------------------------------------
// provisionUser — create (staff mode)
// ---------------------------------------------------------------------------

describe("provisionUser — create (staff mode)", () => {
  it("creates user with is_staff true, no encrypted password", async () => {
    const dispatcharrUser = makeDispatcharrUser({ id: 88, is_staff: true });
    const newMapping = makeMapping({
      id: 7,
      dispatcharr_user_id: 88,
      dispatcharr_xc_password_enc: null,
      provisioning_mode: "staff",
    });

    vi.mocked(createUser).mockResolvedValue({ ok: true, data: dispatcharrUser });
    vi.mocked(createUserMapping).mockReturnValue(newMapping);

    const result = await provisionUser(mockClient, {
      plexIdentity: makePlexIdentity(),
      mode: "staff",
      groupIds: [1],
    });

    expect(result.status).toBe("provisioned");
    if (result.status === "provisioned") {
      // Staff mode surfaces the one-time password for admin onboarding
      expect(result.initialPassword).toBe("generated-password-24");
    }

    // is_staff should be true, and xc_password must still be forwarded so the
    // staff user's /get.php URL works.
    expect(createUser).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({
        is_staff: true,
        custom_properties: { xc_password: "generated-password-24" },
      }),
    );

    // No password encryption
    expect(encrypt).not.toHaveBeenCalled();

    // Null encrypted password in mapping
    expect(createUserMapping).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatcharr_xc_password_enc: null,
        provisioning_mode: "staff",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// provisionUser — create failure
// ---------------------------------------------------------------------------

describe("provisionUser — create failure", () => {
  it("returns failed when encrypt throws", async () => {
    vi.mocked(encrypt).mockRejectedValue(new Error("Key derivation failed"));

    const result = await provisionUser(mockClient, {
      plexIdentity: makePlexIdentity(),
      mode: "automatic",
      groupIds: [1],
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).toBe("Encryption failed: Key derivation failed");
    }

    // Should NOT call createUser or store mapping when encrypt fails
    expect(createUser).not.toHaveBeenCalled();
    expect(createUserMapping).not.toHaveBeenCalled();
    expect(appendAuditLog).not.toHaveBeenCalled();
  });

  it("returns failed when Dispatcharr createUser fails", async () => {
    vi.mocked(createUser).mockResolvedValue({
      ok: false,
      error: "validation_error",
      message: "Username already taken",
    } as DispatcharrResult<DispatcharrUser>);

    const result = await provisionUser(mockClient, {
      plexIdentity: makePlexIdentity(),
      mode: "automatic",
      groupIds: [1],
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).toBe("Username already taken");
    }

    // Should NOT store mapping or audit on failure
    expect(createUserMapping).not.toHaveBeenCalled();
    expect(appendAuditLog).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// provisionUser — username collision handling
// ---------------------------------------------------------------------------

describe("provisionUser — username deduplication", () => {
  it("appends suffix when username collides with existing mappings", async () => {
    vi.mocked(getAllUserMappings).mockReturnValue([
      makeMapping({ dispatcharr_username: "testuser" }),
    ]);

    const dispatcharrUser = makeDispatcharrUser({ id: 50, username: "testuser_2" });
    const newMapping = makeMapping({
      id: 10,
      dispatcharr_user_id: 50,
      dispatcharr_username: "testuser_2",
    });

    vi.mocked(createUser).mockResolvedValue({ ok: true, data: dispatcharrUser });
    vi.mocked(createUserMapping).mockReturnValue(newMapping);

    await provisionUser(mockClient, {
      plexIdentity: makePlexIdentity({ username: "TestUser" }),
      mode: "automatic",
      groupIds: [1],
    });

    expect(createUser).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({ username: "testuser_2" }),
    );
  });

  it("appends suffix when username collides with remote Dispatcharr usernames", async () => {
    // No local collisions
    vi.mocked(getAllUserMappings).mockReturnValue([]);

    // Remote Dispatcharr already has "testuser"
    vi.mocked(fetchAllPages).mockResolvedValue({
      ok: true,
      data: [makeDispatcharrUser({ id: 900, username: "testuser" })],
    });

    const dispatcharrUser = makeDispatcharrUser({ id: 50, username: "testuser_2" });
    const newMapping = makeMapping({
      id: 10,
      dispatcharr_user_id: 50,
      dispatcharr_username: "testuser_2",
    });

    vi.mocked(createUser).mockResolvedValue({ ok: true, data: dispatcharrUser });
    vi.mocked(createUserMapping).mockReturnValue(newMapping);

    await provisionUser(mockClient, {
      plexIdentity: makePlexIdentity({ username: "TestUser" }),
      mode: "automatic",
      groupIds: [1],
    });

    // Should have called fetchAllPages to get remote usernames
    expect(fetchAllPages).toHaveBeenCalledWith(
      mockClient,
      "/api/accounts/users/",
      expect.anything(),
    );

    // Username should be suffixed due to remote collision
    expect(createUser).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({ username: "testuser_2" }),
    );
  });
});

// ---------------------------------------------------------------------------
// provisionUser — audit log entries
// ---------------------------------------------------------------------------

describe("provisionUser — audit logging", () => {
  it("creates audit entry for successful provisioning", async () => {
    const dispatcharrUser = makeDispatcharrUser({ id: 60 });
    const newMapping = makeMapping({ id: 8, dispatcharr_user_id: 60 });

    vi.mocked(createUser).mockResolvedValue({ ok: true, data: dispatcharrUser });
    vi.mocked(createUserMapping).mockReturnValue(newMapping);

    await provisionUser(mockClient, {
      plexIdentity: makePlexIdentity({ username: "AuditTestUser" }),
      mode: "automatic",
      groupIds: [],
    });

    expect(appendAuditLog).toHaveBeenCalledTimes(1);
    expect(appendAuditLog).toHaveBeenCalledWith({
      action: "user.provisioned",
      detail: expect.objectContaining({
        plex_username: "AuditTestUser",
        mode: "automatic",
      }),
    });
  });

  it("creates audit entry for reactivation", async () => {
    const inactive = makeMapping({ is_active: 0, dispatcharr_user_id: 42 });
    const reactivated = makeMapping({ is_active: 1 });

    vi.mocked(getUserMappingByPlexId)
      .mockReturnValueOnce(inactive)
      .mockReturnValueOnce(reactivated);

    vi.mocked(getUser).mockResolvedValue({
      ok: true,
      data: makeDispatcharrUser(),
    } as DispatcharrResult<DispatcharrUser>);

    await provisionUser(mockClient, {
      plexIdentity: makePlexIdentity(),
      mode: "automatic",
      groupIds: [],
    });

    expect(appendAuditLog).toHaveBeenCalledWith({
      action: "user.provisioned",
      detail: { plex_username: "TestUser", reactivated: true },
    });
  });

  it("does not create audit entry when provisioning fails", async () => {
    vi.mocked(createUser).mockResolvedValue({
      ok: false,
      error: "validation_error",
      message: "Username already taken",
    } as DispatcharrResult<DispatcharrUser>);

    await provisionUser(mockClient, {
      plexIdentity: makePlexIdentity(),
      mode: "automatic",
      groupIds: [],
    });

    expect(appendAuditLog).not.toHaveBeenCalled();
  });
});
