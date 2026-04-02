import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Mock ofetch
// ---------------------------------------------------------------------------

const mockOfetch = vi.fn();

vi.mock("ofetch", () => ({
  ofetch: (...args: unknown[]) => mockOfetch(...args),
}));

// Import after mocking
const { DispatcharrClient } = await import("../client");
const { fetchAllPages } = await import("../pagination");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const itemSchema = z.object({ id: z.number(), name: z.string() });
type Item = z.infer<typeof itemSchema>;

function createClient() {
  return new DispatcharrClient("https://dispatch.example.com", "test-key");
}

function makePaginatedResponse(
  results: Item[],
  next: string | null = null,
  previous: string | null = null,
  count?: number,
) {
  return {
    count: count ?? results.length,
    next,
    previous,
    results,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockOfetch.mockReset();
});

describe("fetchAllPages", () => {
  it("collects all items across pages", async () => {
    mockOfetch
      .mockResolvedValueOnce(
        makePaginatedResponse(
          [
            { id: 1, name: "one" },
            { id: 2, name: "two" },
          ],
          "https://dispatch.example.com/api/resource/?page=2",
          null,
          4,
        ),
      )
      .mockResolvedValueOnce(
        makePaginatedResponse(
          [
            { id: 3, name: "three" },
            { id: 4, name: "four" },
          ],
          null,
          "https://dispatch.example.com/api/resource/",
          4,
        ),
      );

    const client = createClient();
    const result = await fetchAllPages(client, "/api/resource/", itemSchema);

    expect(result).toEqual({
      ok: true,
      data: [
        { id: 1, name: "one" },
        { id: 2, name: "two" },
        { id: 3, name: "three" },
        { id: 4, name: "four" },
      ],
    });
  });

  it("returns empty array for empty response", async () => {
    mockOfetch.mockResolvedValueOnce(makePaginatedResponse([], null, null, 0));

    const client = createClient();
    const result = await fetchAllPages(client, "/api/resource/", itemSchema);

    expect(result).toEqual({ ok: true, data: [] });
  });

  it("follows multiple pages via next URLs", async () => {
    mockOfetch
      .mockResolvedValueOnce(
        makePaginatedResponse(
          [{ id: 1, name: "one" }],
          "https://dispatch.example.com/api/resource/?page=2",
          null,
          3,
        ),
      )
      .mockResolvedValueOnce(
        makePaginatedResponse(
          [{ id: 2, name: "two" }],
          "https://dispatch.example.com/api/resource/?page=3",
          "https://dispatch.example.com/api/resource/",
          3,
        ),
      )
      .mockResolvedValueOnce(
        makePaginatedResponse(
          [{ id: 3, name: "three" }],
          null,
          "https://dispatch.example.com/api/resource/?page=2",
          3,
        ),
      );

    const client = createClient();
    const result = await fetchAllPages(client, "/api/resource/", itemSchema);

    expect(result).toEqual({
      ok: true,
      data: [
        { id: 1, name: "one" },
        { id: 2, name: "two" },
        { id: 3, name: "three" },
      ],
    });
    expect(mockOfetch).toHaveBeenCalledTimes(3);
  });

  it("strips baseUrl from absolute next URLs", async () => {
    mockOfetch
      .mockResolvedValueOnce(
        makePaginatedResponse(
          [{ id: 1, name: "one" }],
          "https://dispatch.example.com/api/resource/?page=2",
        ),
      )
      .mockResolvedValueOnce(makePaginatedResponse([{ id: 2, name: "two" }]));

    const client = createClient();
    await fetchAllPages(client, "/api/resource/", itemSchema);

    // Second call should use the relative path resolved against baseUrl
    expect(mockOfetch).toHaveBeenNthCalledWith(
      2,
      "https://dispatch.example.com/api/resource/?page=2",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns error result on fetch error", async () => {
    mockOfetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const client = createClient();
    const result = await fetchAllPages(client, "/api/resource/", itemSchema);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("network_error");
    }
  });

  it("returns error result on schema validation failure", async () => {
    mockOfetch.mockResolvedValueOnce({
      count: 1,
      next: null,
      previous: null,
      results: [{ id: "not-a-number", name: 42 }],
    });

    const client = createClient();
    const result = await fetchAllPages(client, "/api/resource/", itemSchema);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("unexpected_shape");
    }
  });
});
