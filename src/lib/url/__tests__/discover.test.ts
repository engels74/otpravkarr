import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock ofetch
// ---------------------------------------------------------------------------

const mockOfetch = vi.fn();

vi.mock("ofetch", () => ({
  ofetch: (...args: unknown[]) => mockOfetch(...args),
}));

// Import after mocking
const { probeXcSurface } = await import("../discover");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

describe("probeXcSurface", () => {
  const HOST = "https://xc.example.com";
  const USER = "testuser";
  const PASS = "testpass";

  describe("get.php returns M3U content", () => {
    it("returns found: true with get.php template", async () => {
      mockOfetch.mockResolvedValueOnce(
        "#EXTM3U\n#EXTINF:-1,Channel 1\nhttp://stream.example.com/1",
      );

      const result = await probeXcSurface(HOST, USER, PASS);

      expect(result.found).toBe(true);
      expect(result.template).toBe(
        "https://xc.example.com/get.php?username={username}&password={password}&type=m3u_plus",
      );
      expect(result.probedPaths).toHaveLength(1);
      expect(result.probedPaths[0]).toContain("get.php");
      // Only the first probe should have been called
      expect(mockOfetch).toHaveBeenCalledTimes(1);
    });

    it("detects M3U content with leading whitespace", async () => {
      mockOfetch.mockResolvedValueOnce("  \n#EXTM3U\n#EXTINF:-1,Ch1\nhttp://s/1");

      const result = await probeXcSurface(HOST, USER, PASS);

      expect(result.found).toBe(true);
      expect(result.template).toContain("get.php");
    });
  });

  describe("player_api.php returns JSON with user_info", () => {
    it("returns found: true with player_api template", async () => {
      // get.php fails
      mockOfetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      // player_api.php succeeds
      mockOfetch.mockResolvedValueOnce({
        user_info: { username: USER, status: "Active" },
        server_info: { url: HOST },
      });

      const result = await probeXcSurface(HOST, USER, PASS);

      expect(result.found).toBe(true);
      expect(result.template).toBe(
        "https://xc.example.com/player_api.php?username={username}&password={password}",
      );
      expect(result.probedPaths).toHaveLength(2);
      expect(result.probedPaths[0]).toContain("get.php");
      expect(result.probedPaths[1]).toContain("player_api.php");
      expect(mockOfetch).toHaveBeenCalledTimes(2);
    });

    it("detects server_info key alone", async () => {
      mockOfetch.mockRejectedValueOnce(new Error("fail"));
      mockOfetch.mockResolvedValueOnce({
        server_info: { timezone: "UTC" },
      });

      const result = await probeXcSurface(HOST, USER, PASS);

      expect(result.found).toBe(true);
      expect(result.template).toContain("player_api.php");
    });
  });

  describe("get_live_categories returns JSON array", () => {
    it("returns found: true when first two probes fail", async () => {
      // get.php fails
      mockOfetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      // player_api.php returns non-matching JSON
      mockOfetch.mockResolvedValueOnce({ error: "unknown_action" });
      // get_live_categories succeeds
      mockOfetch.mockResolvedValueOnce([
        { category_id: "1", category_name: "Sports" },
        { category_id: "2", category_name: "Movies" },
      ]);

      const result = await probeXcSurface(HOST, USER, PASS);

      expect(result.found).toBe(true);
      expect(result.template).toContain("player_api.php");
      expect(result.probedPaths).toHaveLength(3);
      expect(mockOfetch).toHaveBeenCalledTimes(3);
    });

    it("rejects empty JSON array as not XC", async () => {
      mockOfetch.mockRejectedValueOnce(new Error("fail"));
      mockOfetch.mockResolvedValueOnce({ error: "unknown_action" });
      mockOfetch.mockResolvedValueOnce([]);

      const result = await probeXcSurface(HOST, USER, PASS);

      expect(result.found).toBe(false);
    });

    it("rejects array without category_id field as not XC", async () => {
      mockOfetch.mockRejectedValueOnce(new Error("fail"));
      mockOfetch.mockResolvedValueOnce({ error: "unknown_action" });
      mockOfetch.mockResolvedValueOnce([
        { id: 1, name: "not-xc-data" },
        { id: 2, name: "also-not-xc" },
      ]);

      const result = await probeXcSurface(HOST, USER, PASS);

      expect(result.found).toBe(false);
    });
  });

  describe("all probes fail (network error)", () => {
    it("returns found: false with all probed paths", async () => {
      mockOfetch.mockRejectedValue(new Error("ECONNREFUSED"));

      const result = await probeXcSurface(HOST, USER, PASS);

      expect(result.found).toBe(false);
      expect(result.template).toBeUndefined();
      expect(result.probedPaths).toHaveLength(3);
      expect(result.probedPaths[0]).toContain("get.php");
      expect(result.probedPaths[1]).toContain("player_api.php");
      expect(result.probedPaths[2]).toContain("player_api.php");
      expect(result.probedPaths[2]).toContain("get_live_categories");
      expect(mockOfetch).toHaveBeenCalledTimes(3);
    });
  });

  describe("all probes return 404", () => {
    it("returns found: false", async () => {
      mockOfetch.mockRejectedValue(makeFetchError(404, "Not Found"));

      const result = await probeXcSurface(HOST, USER, PASS);

      expect(result.found).toBe(false);
      expect(result.template).toBeUndefined();
      expect(result.probedPaths).toHaveLength(3);
    });
  });

  describe("first probe fails, second succeeds", () => {
    it("returns found: true from second probe", async () => {
      // get.php returns 404
      mockOfetch.mockRejectedValueOnce(makeFetchError(404, "Not Found"));
      // player_api.php succeeds
      mockOfetch.mockResolvedValueOnce({
        user_info: { username: USER },
      });

      const result = await probeXcSurface(HOST, USER, PASS);

      expect(result.found).toBe(true);
      expect(result.template).toContain("player_api.php");
      expect(result.probedPaths).toHaveLength(2);
    });
  });

  describe("timeout handling", () => {
    it("passes timeout option to ofetch", async () => {
      mockOfetch.mockResolvedValueOnce("#EXTM3U\n#EXTINF:-1,Ch\nhttp://s/1");

      await probeXcSurface(HOST, USER, PASS);

      expect(mockOfetch).toHaveBeenCalledWith(
        expect.stringContaining("get.php"),
        expect.objectContaining({ timeout: 5_000 }),
      );
    });

    it("handles timeout errors gracefully", async () => {
      const timeoutErr = new Error("The operation was aborted due to timeout");
      timeoutErr.name = "TimeoutError";
      mockOfetch.mockRejectedValue(timeoutErr);

      const result = await probeXcSurface(HOST, USER, PASS);

      expect(result.found).toBe(false);
      expect(result.probedPaths).toHaveLength(3);
    });
  });

  describe("edge cases", () => {
    it("strips trailing slash from host", async () => {
      mockOfetch.mockResolvedValueOnce("#EXTM3U\ncontent");

      const result = await probeXcSurface("https://xc.example.com/", USER, PASS);

      expect(result.found).toBe(true);
      expect(result.template).toBe(
        "https://xc.example.com/get.php?username={username}&password={password}&type=m3u_plus",
      );
      expect(mockOfetch).toHaveBeenCalledWith(
        expect.stringContaining("https://xc.example.com/get.php"),
        expect.any(Object),
      );
    });

    it("adds http:// scheme to bare host", async () => {
      mockOfetch.mockResolvedValueOnce("#EXTM3U\ncontent");

      const result = await probeXcSurface("iptv.example.com", USER, PASS);

      expect(result.found).toBe(true);
      expect(result.template).toBe(
        "http://iptv.example.com/get.php?username={username}&password={password}&type=m3u_plus",
      );
      expect(mockOfetch).toHaveBeenCalledWith(
        expect.stringContaining("http://iptv.example.com/get.php"),
        expect.any(Object),
      );
    });

    it("get.php returns empty string — treated as not found", async () => {
      mockOfetch.mockResolvedValueOnce("");
      // player_api.php succeeds
      mockOfetch.mockResolvedValueOnce({ user_info: { username: USER } });

      const result = await probeXcSurface(HOST, USER, PASS);

      expect(result.found).toBe(true);
      expect(result.template).toContain("player_api.php");
      expect(result.probedPaths).toHaveLength(2);
    });

    it("get.php returns HTML — treated as not found", async () => {
      mockOfetch.mockResolvedValueOnce("<html>Access Denied</html>");
      // subsequent probes also fail
      mockOfetch.mockRejectedValueOnce(new Error("fail"));
      mockOfetch.mockRejectedValueOnce(new Error("fail"));

      const result = await probeXcSurface(HOST, USER, PASS);
      expect(result.found).toBe(false);
    });

    it("redacts URL-encoded credentials from probedPaths", async () => {
      const specialUser = "user&name";
      const specialPass = "p@ss=word";
      mockOfetch.mockRejectedValue(new Error("ECONNREFUSED"));

      const result = await probeXcSurface(HOST, specialUser, specialPass);

      expect(result.found).toBe(false);
      for (const path of result.probedPaths) {
        expect(path).not.toContain(specialUser);
        expect(path).not.toContain(specialPass);
        expect(path).not.toContain(encodeURIComponent(specialUser));
        expect(path).not.toContain(encodeURIComponent(specialPass));
        expect(path).toContain("***");
      }
    });

    it("player_api returns null — not matched", async () => {
      mockOfetch.mockRejectedValueOnce(new Error("fail"));
      mockOfetch.mockResolvedValueOnce(null);
      mockOfetch.mockRejectedValueOnce(new Error("fail"));

      const result = await probeXcSurface(HOST, USER, PASS);

      expect(result.found).toBe(false);
    });
  });
});
