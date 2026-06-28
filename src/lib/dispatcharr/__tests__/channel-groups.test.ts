import { beforeEach, describe, expect, it, vi } from "vitest";

const mockOfetch = vi.fn();
vi.mock("ofetch", () => ({ ofetch: (...args: unknown[]) => mockOfetch(...args) }));

const { DispatcharrClient } = await import("../client");
const { listChannelGroups } = await import("../endpoints/channel-groups");

function createClient() {
  return new DispatcharrClient("https://dispatch.example.com", "test-key");
}

function makePaginated(results: unknown[], next: string | null = null) {
  return { count: results.length, next, previous: null, results };
}

beforeEach(() => mockOfetch.mockReset());

describe("listChannelGroups", () => {
  it("returns channel groups from a flat array response", async () => {
    mockOfetch.mockResolvedValueOnce([
      { id: 1, name: "Sports", channel_count: 12, m3u_account_count: 1, m3u_accounts: [] },
      { id: 2, name: "News", channel_count: 5 },
    ]);

    const result = await listChannelGroups(createClient());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toMatchObject({ id: 1, name: "Sports", channel_count: 12 });
    }
  });

  it("collects channel groups across paginated responses", async () => {
    mockOfetch
      .mockResolvedValueOnce(
        makePaginated(
          [{ id: 1, name: "Sports", channel_count: 1 }],
          "https://dispatch.example.com/api/channels/groups/?page=2",
        ),
      )
      .mockResolvedValueOnce(makePaginated([{ id: 2, name: "News", channel_count: 2 }]));

    const result = await listChannelGroups(createClient());

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.map((g) => g.id)).toEqual([1, 2]);
  });

  it("tolerates a missing channel_count", async () => {
    mockOfetch.mockResolvedValueOnce([{ id: 3, name: "Movies" }]);
    const result = await listChannelGroups(createClient());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data[0]?.channel_count).toBeUndefined();
  });

  it("surfaces auth failures", async () => {
    const err = new Error("Unauthorized") as Error & { statusCode: number; statusMessage: string };
    err.statusCode = 401;
    err.statusMessage = "Unauthorized";
    mockOfetch.mockRejectedValueOnce(err);

    const result = await listChannelGroups(createClient());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("auth_failure");
  });
});
