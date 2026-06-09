import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ctrl/plex", () => {
  const mockGetWebLogin = vi.fn();
  const mockWebLoginCheck = vi.fn();
  return {
    MyPlexAccount: {
      getWebLogin: mockGetWebLogin,
      webLoginCheck: mockWebLoginCheck,
    },
  };
});

const { MyPlexAccount } = await import("@ctrl/plex");

const { initiateOAuth, completeOAuth, getPendingOAuth, removePendingOAuth, cleanExpiredOAuth } =
  await import("$lib/plex/oauth");

const mockGetWebLogin = MyPlexAccount.getWebLogin as ReturnType<typeof vi.fn>;
const mockWebLoginCheck = MyPlexAccount.webLoginCheck as ReturnType<typeof vi.fn>;

describe("oauth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Clean up any pending OAuth sessions to prevent cross-test leakage.
    // Advance past the 10-minute expiry window so cleanExpiredOAuth() removes all entries.
    vi.advanceTimersByTime(11 * 60 * 1000);
    cleanExpiredOAuth();
    vi.useRealTimers();
  });

  describe("initiateOAuth", () => {
    it("calls getWebLogin and returns id and uri", async () => {
      const fakeWebLogin = { id: 1, code: "abc", uri: "https://plex.tv/auth#abc" };
      mockGetWebLogin.mockResolvedValue(fakeWebLogin);

      const result = await initiateOAuth("https://example.com/callback");

      expect(mockGetWebLogin).toHaveBeenCalledWith("https://example.com/callback");
      expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(result.uri).toBe("https://plex.tv/auth#abc");
    });

    it("stores the session in the pending map", async () => {
      const fakeWebLogin = { id: 1, code: "abc", uri: "https://plex.tv/auth#abc" };
      mockGetWebLogin.mockResolvedValue(fakeWebLogin);

      const { id } = await initiateOAuth("https://example.com/callback");
      expect(getPendingOAuth(id)).toBe(true);
    });
  });

  describe("completeOAuth", () => {
    it("retrieves from map, calls webLoginCheck, returns PlexIdentity, and removes from map", async () => {
      const fakeWebLogin = { id: 1, code: "abc", uri: "https://plex.tv/auth#abc" };
      mockGetWebLogin.mockResolvedValue(fakeWebLogin);

      const fakeAccount = {
        id: 42,
        uuid: "uuid-123",
        username: "testuser",
        email: "test@example.com",
        thumb: "https://plex.tv/thumb.png",
        authenticationToken: "tok-abc",
      };
      mockWebLoginCheck.mockResolvedValue(fakeAccount);

      const { id } = await initiateOAuth("https://example.com/callback");
      const identity = await completeOAuth(id);

      expect(mockWebLoginCheck).toHaveBeenCalledWith(fakeWebLogin, { timeoutSeconds: 120 });
      expect(identity).toEqual({
        id: 42,
        uuid: "uuid-123",
        username: "testuser",
        email: "test@example.com",
        thumb: "https://plex.tv/thumb.png",
        authenticationToken: "tok-abc",
      });
      expect(getPendingOAuth(id)).toBe(false);
    });

    it("returns cached identity on retry after successful completion", async () => {
      const fakeWebLogin = { id: 1, code: "abc", uri: "https://plex.tv/auth#abc" };
      mockGetWebLogin.mockResolvedValue(fakeWebLogin);

      const fakeAccount = {
        id: 42,
        uuid: "uuid-123",
        username: "testuser",
        email: "test@example.com",
        thumb: "https://plex.tv/thumb.png",
        authenticationToken: "tok-abc",
      };
      mockWebLoginCheck.mockResolvedValue(fakeAccount);

      const { id } = await initiateOAuth("https://example.com/callback");
      const first = await completeOAuth(id);
      const second = await completeOAuth(id);

      expect(first).toEqual(second);
      expect(mockWebLoginCheck).toHaveBeenCalledTimes(1);
      expect(getPendingOAuth(id)).toBe(false);
    });

    it("throws when ID is not found", async () => {
      await expect(completeOAuth("nonexistent-id")).rejects.toThrow(
        "OAuth session not found or expired",
      );
    });

    it("throws when session is expired", async () => {
      const fakeWebLogin = { id: 1, code: "abc", uri: "https://plex.tv/auth#abc" };
      mockGetWebLogin.mockResolvedValue(fakeWebLogin);

      const { id } = await initiateOAuth("https://example.com/callback");

      // Advance past expiry (10 minutes + 1ms)
      vi.advanceTimersByTime(10 * 60 * 1000 + 1);

      await expect(completeOAuth(id)).rejects.toThrow("OAuth session not found or expired");
    });

    it("uses custom timeoutSeconds when provided", async () => {
      const fakeWebLogin = { id: 1, code: "abc", uri: "https://plex.tv/auth#abc" };
      mockGetWebLogin.mockResolvedValue(fakeWebLogin);
      mockWebLoginCheck.mockResolvedValue({
        id: 1,
        uuid: "u",
        username: "u",
        email: "e",
        thumb: "t",
        authenticationToken: "a",
      });

      const { id } = await initiateOAuth("https://example.com/callback");
      await completeOAuth(id, 60);

      expect(mockWebLoginCheck).toHaveBeenCalledWith(fakeWebLogin, { timeoutSeconds: 60 });
    });
  });

  describe("getPendingOAuth", () => {
    it("returns true for an existing non-expired session", async () => {
      const fakeWebLogin = { id: 1, code: "abc", uri: "https://plex.tv/auth#abc" };
      mockGetWebLogin.mockResolvedValue(fakeWebLogin);

      const { id } = await initiateOAuth("https://example.com/callback");
      expect(getPendingOAuth(id)).toBe(true);
    });

    it("returns false for a missing session", () => {
      expect(getPendingOAuth("does-not-exist")).toBe(false);
    });

    it("returns false for an expired session", async () => {
      const fakeWebLogin = { id: 1, code: "abc", uri: "https://plex.tv/auth#abc" };
      mockGetWebLogin.mockResolvedValue(fakeWebLogin);

      const { id } = await initiateOAuth("https://example.com/callback");
      vi.advanceTimersByTime(10 * 60 * 1000 + 1);
      expect(getPendingOAuth(id)).toBe(false);
    });
  });

  describe("removePendingOAuth", () => {
    it("removes entry from map", async () => {
      const fakeWebLogin = { id: 1, code: "abc", uri: "https://plex.tv/auth#abc" };
      mockGetWebLogin.mockResolvedValue(fakeWebLogin);

      const { id } = await initiateOAuth("https://example.com/callback");
      expect(getPendingOAuth(id)).toBe(true);

      removePendingOAuth(id);
      expect(getPendingOAuth(id)).toBe(false);
    });

    it("evicts completed cache so a subsequent completeOAuth call fails after eviction", async () => {
      const fakeWebLogin = { id: 1, code: "abc", uri: "https://plex.tv/auth#abc" };
      mockGetWebLogin.mockResolvedValue(fakeWebLogin);
      mockWebLoginCheck.mockResolvedValue({
        id: 42,
        uuid: "uuid-123",
        username: "testuser",
        email: "test@example.com",
        thumb: "https://plex.tv/thumb.png",
        authenticationToken: "tok-abc",
      });

      const { id } = await initiateOAuth("https://example.com/callback");
      const identity = await completeOAuth(id);
      expect(identity.id).toBe(42);

      // Evict — simulates portal single-use enforcement.
      removePendingOAuth(id);

      // Second completeOAuth must fail: both pending and completed are gone.
      await expect(completeOAuth(id)).rejects.toThrow("OAuth session not found or expired");
    });

    it("setup two-step semantics: completeOAuth twice without eviction returns same identity", async () => {
      const fakeWebLogin = { id: 1, code: "abc", uri: "https://plex.tv/auth#abc" };
      mockGetWebLogin.mockResolvedValue(fakeWebLogin);
      mockWebLoginCheck.mockResolvedValue({
        id: 42,
        uuid: "uuid-123",
        username: "testuser",
        email: "test@example.com",
        thumb: "https://plex.tv/thumb.png",
        authenticationToken: "tok-abc",
      });

      const { id } = await initiateOAuth("https://example.com/callback");

      // First call (oauth_discover): resolves and caches.
      const first = await completeOAuth(id);
      // Second call (oauth_complete): returns cached identity without re-checking.
      const second = await completeOAuth(id);

      expect(first).toEqual(second);
      // webLoginCheck must only have been called once (cache hit on second call).
      expect(mockWebLoginCheck).toHaveBeenCalledTimes(1);
    });
  });

  describe("cleanExpiredOAuth", () => {
    it("removes expired entries and keeps fresh ones", async () => {
      const fakeWebLogin = { id: 1, code: "abc", uri: "https://plex.tv/auth#abc" };
      mockGetWebLogin.mockResolvedValue(fakeWebLogin);

      // Create first session
      const { id: oldId } = await initiateOAuth("https://example.com/callback");

      // Advance 9 minutes
      vi.advanceTimersByTime(9 * 60 * 1000);

      // Create second session
      const { id: newId } = await initiateOAuth("https://example.com/callback");

      // Advance 2 more minutes (old is 11min, new is 2min)
      vi.advanceTimersByTime(2 * 60 * 1000);

      cleanExpiredOAuth();

      expect(getPendingOAuth(oldId)).toBe(false);
      expect(getPendingOAuth(newId)).toBe(true);
    });
  });
});
