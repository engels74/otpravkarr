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
const { listGroups } = await import("../endpoints/groups");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createClient() {
  return new DispatcharrClient("https://dispatch.example.com", "test-key");
}

function makeGroup(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "Viewers",
    permissions: [],
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

describe("listGroups", () => {
  it("returns all groups from a single page", async () => {
    const groups = [makeGroup(), makeGroup({ id: 2, name: "Admins" })];
    mockOfetch.mockResolvedValueOnce(makePaginatedResponse(groups));
    const client = createClient();

    const result = await listGroups(client);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(groups);
      expect(result.data).toHaveLength(2);
    }
  });

  it("collects groups across multiple pages", async () => {
    mockOfetch
      .mockResolvedValueOnce(
        makePaginatedResponse(
          [makeGroup({ id: 1, name: "A" })],
          "https://dispatch.example.com/api/accounts/groups/?page=2",
          2,
        ),
      )
      .mockResolvedValueOnce(makePaginatedResponse([makeGroup({ id: 2, name: "B" })], null, 2));
    const client = createClient();

    const result = await listGroups(client);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0]?.name).toBe("A");
      expect(result.data[1]?.name).toBe("B");
    }
  });

  it("returns empty array when no groups exist", async () => {
    mockOfetch.mockResolvedValueOnce(makePaginatedResponse([]));
    const client = createClient();

    const result = await listGroups(client);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([]);
    }
  });

  it("returns error on auth failure", async () => {
    mockOfetch.mockRejectedValueOnce(makeFetchError(401, "Unauthorized"));
    const client = createClient();

    const result = await listGroups(client);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("network_error");
      expect(result.message).toContain("Pagination failed");
    }
  });

  it("returns error on network failure", async () => {
    mockOfetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const client = createClient();

    const result = await listGroups(client);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("network_error");
    }
  });
});
