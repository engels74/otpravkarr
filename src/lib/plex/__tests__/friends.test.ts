import type { MyPlexAccount } from "@ctrl/plex";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchFriends, isCurrentFriend, getCachedFriends, invalidateFriendsCache } = await import(
  "../friends"
);

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const validFriends = [
  {
    id: 1001,
    uuid: "uuid-1",
    username: "friend1",
    email: "f1@test.com",
    thumb: "https://plex.tv/thumb/1",
    status: "accepted",
  },
  {
    id: 1002,
    username: "friend2",
    email: "f2@test.com",
    status: "accepted",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockAccount(queryFn: ReturnType<typeof vi.fn>) {
  return { query: queryFn } as unknown as MyPlexAccount;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  invalidateFriendsCache();
});

describe("fetchFriends", () => {
  it("returns PlexFriend array for valid response", async () => {
    const mockAccount = createMockAccount(vi.fn().mockResolvedValue(validFriends));
    const result = await fetchFriends(mockAccount);

    expect(result).toEqual(validFriends);
  });

  it("calls account.query with correct URL and method", async () => {
    const queryFn = vi.fn().mockResolvedValue([]);
    const mockAccount = createMockAccount(queryFn);

    await fetchFriends(mockAccount);

    expect(queryFn).toHaveBeenCalledWith({
      url: "https://plex.tv/api/v2/friends",
      method: "get",
    });
  });

  it("throws on malformed response", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mockAccount = createMockAccount(vi.fn().mockResolvedValue([{ bad: "data" }]));

    await expect(fetchFriends(mockAccount)).rejects.toThrow(
      "Unexpected Plex friends response shape:",
    );
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("throws on network error", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mockAccount = createMockAccount(vi.fn().mockRejectedValue(new Error("Network failure")));

    await expect(fetchFriends(mockAccount)).rejects.toThrow("Network failure");
    expect(warnSpy).toHaveBeenCalledWith("Failed to fetch Plex friends:", "Network failure");

    warnSpy.mockRestore();
  });

  it("accepts friends with title/friendlyName but no username", async () => {
    const friendsWithoutUsername = [
      {
        id: 2001,
        title: "DisplayName",
        friendlyName: "FriendlyUser",
        email: "nouser@test.com",
        status: "accepted",
      },
    ];
    const mockAccount = createMockAccount(vi.fn().mockResolvedValue(friendsWithoutUsername));
    const result = await fetchFriends(mockAccount);
    expect(result).toEqual(friendsWithoutUsername);
  });

  it("accepts friends with null optional fields (Plex API returns null)", async () => {
    const friendsWithNulls = [
      {
        id: 3001,
        uuid: null,
        username: "nullfriendly",
        title: null,
        friendlyName: null,
        email: "nullfields@test.com",
        thumb: null,
        status: "accepted",
      },
    ];
    const mockAccount = createMockAccount(vi.fn().mockResolvedValue(friendsWithNulls));
    const result = await fetchFriends(mockAccount);
    expect(result).toEqual(friendsWithNulls);
  });

  it("returns empty array for empty array response", async () => {
    const mockAccount = createMockAccount(vi.fn().mockResolvedValue([]));
    const result = await fetchFriends(mockAccount);
    expect(result).toEqual([]);
  });

  it("updates cache after successful fetch", async () => {
    const mockAccount = createMockAccount(vi.fn().mockResolvedValue(validFriends));

    expect(getCachedFriends()).toBeNull();

    await fetchFriends(mockAccount);

    expect(getCachedFriends()).toEqual(validFriends);
  });
});

describe("isCurrentFriend", () => {
  it("returns true when ID exists in list", () => {
    expect(isCurrentFriend(1001, validFriends)).toBe(true);
  });

  it("returns false when ID not in list", () => {
    expect(isCurrentFriend(9999, validFriends)).toBe(false);
  });
});

describe("getCachedFriends", () => {
  it("returns null when no cache", () => {
    expect(getCachedFriends()).toBeNull();
  });

  it("returns friends when cache is fresh", async () => {
    const mockAccount = createMockAccount(vi.fn().mockResolvedValue(validFriends));
    await fetchFriends(mockAccount);

    expect(getCachedFriends()).toEqual(validFriends);
  });

  it("returns null when cache is expired", async () => {
    vi.useFakeTimers();
    try {
      const mockAccount = createMockAccount(vi.fn().mockResolvedValue(validFriends));
      await fetchFriends(mockAccount);

      // Advance time past the TTL
      vi.advanceTimersByTime(1000);
      expect(getCachedFriends(500)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("invalidateFriendsCache", () => {
  it("clears the cache", async () => {
    const mockAccount = createMockAccount(vi.fn().mockResolvedValue(validFriends));
    await fetchFriends(mockAccount);

    expect(getCachedFriends()).toEqual(validFriends);

    invalidateFriendsCache();

    expect(getCachedFriends()).toBeNull();
  });
});
