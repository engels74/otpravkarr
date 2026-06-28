import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock ofetch
// ---------------------------------------------------------------------------

const mockOfetch = vi.fn();

vi.mock("ofetch", () => ({
  ofetch: (...args: unknown[]) => mockOfetch(...args),
}));

// Import after mocking
const { DispatcharrClient } = await import("../client");
const { listProfiles, getProfile, createProfile, bulkUpdateProfileMembership } = await import(
  "../endpoints/profiles"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createClient() {
  return new DispatcharrClient("https://dispatch.example.com", "test-key");
}

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "Default",
    ...overrides,
  };
}

function makePaginatedResponse(results: unknown[], next: string | null = null, count?: number) {
  return {
    count: count ?? results.length,
    next,
    previous: null,
    results,
  };
}

function makeFetchError(statusCode: number, message = "Error") {
  const err = new Error(message) as Error & {
    statusCode: number;
    statusMessage: string;
  };
  err.statusCode = statusCode;
  err.statusMessage = message;
  return err;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockOfetch.mockReset();
});

describe("listProfiles", () => {
  it("returns all profiles from a single page", async () => {
    const profiles = [makeProfile(), makeProfile({ id: 2, name: "Premium" })];
    mockOfetch.mockResolvedValueOnce(makePaginatedResponse(profiles));
    const client = createClient();

    const result = await listProfiles(client);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(profiles);
      expect(result.data).toHaveLength(2);
    }
  });

  it("collects profiles across multiple pages", async () => {
    mockOfetch
      .mockResolvedValueOnce(
        makePaginatedResponse(
          [makeProfile({ id: 1, name: "Basic" })],
          "https://dispatch.example.com/api/channels/profiles/?page=2",
          2,
        ),
      )
      .mockResolvedValueOnce(
        makePaginatedResponse([makeProfile({ id: 2, name: "Premium" })], null, 2),
      );
    const client = createClient();

    const result = await listProfiles(client);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0]?.name).toBe("Basic");
      expect(result.data[1]?.name).toBe("Premium");
    }
  });

  it("returns empty array when no profiles exist", async () => {
    mockOfetch.mockResolvedValueOnce(makePaginatedResponse([]));
    const client = createClient();

    const result = await listProfiles(client);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([]);
    }
  });

  it("returns error on auth failure", async () => {
    mockOfetch.mockRejectedValueOnce(makeFetchError(401, "Unauthorized"));
    const client = createClient();

    const result = await listProfiles(client);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("auth_failure");
      expect(result.message).toContain("Pagination failed");
    }
  });

  it("returns error on network failure", async () => {
    mockOfetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const client = createClient();

    const result = await listProfiles(client);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("network_error");
    }
  });
});
describe("getProfile", () => {
  it("returns the profile with its enabled-channel membership", async () => {
    mockOfetch.mockResolvedValueOnce({ id: 1, name: "Sports", channels: [10, 11, 12] });
    const result = await getProfile(createClient(), 1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe(1);
      expect(result.data.channels).toEqual([10, 11, 12]);
    }
    expect(mockOfetch).toHaveBeenCalledWith(
      "https://dispatch.example.com/api/channels/profiles/1/",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("coerces a non-array channels field (OpenAPI types it as string) to []", async () => {
    mockOfetch.mockResolvedValueOnce({ id: 2, name: "News", channels: "weird" });
    const result = await getProfile(createClient(), 2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.channels).toEqual([]);
  });
});

describe("createProfile", () => {
  it("POSTs the name and returns the created profile", async () => {
    mockOfetch.mockResolvedValueOnce({ id: 7, name: "otpravkarr:g1:Sports", channels: [1, 2, 3] });
    const result = await createProfile(createClient(), "otpravkarr:g1:Sports");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.id).toBe(7);
    expect(mockOfetch).toHaveBeenCalledWith(
      "https://dispatch.example.com/api/channels/profiles/",
      expect.objectContaining({ method: "POST", body: { name: "otpravkarr:g1:Sports" } }),
    );
  });

  it("returns a validation_error on a duplicate name (400)", async () => {
    const err = new Error("exists") as Error & { statusCode: number; statusMessage: string };
    err.statusCode = 400;
    err.statusMessage = "exists";
    mockOfetch.mockRejectedValueOnce(err);
    const result = await createProfile(createClient(), "dup");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("validation_error");
  });
});

describe("bulkUpdateProfileMembership", () => {
  it("PATCHes the membership diff to the bulk-update endpoint", async () => {
    mockOfetch.mockResolvedValueOnce({ detail: "ok" });
    const result = await bulkUpdateProfileMembership(createClient(), 5, [
      { channel_id: 1, enabled: false },
      { channel_id: 2, enabled: true },
    ]);
    expect(result.ok).toBe(true);
    expect(mockOfetch).toHaveBeenCalledWith(
      "https://dispatch.example.com/api/channels/profiles/5/channels/bulk-update/",
      expect.objectContaining({
        method: "PATCH",
        body: {
          channels: [
            { channel_id: 1, enabled: false },
            { channel_id: 2, enabled: true },
          ],
        },
      }),
    );
  });
});
