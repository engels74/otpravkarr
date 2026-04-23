import { describe, expect, it, vi } from "vitest";

vi.mock("../../db/repositories/config", () => ({
  getConfig: vi.fn(),
}));

const { getConfig } = await import("../../db/repositories/config");
const { getDispatcharrPublicUrl } = await import("../resolve.server");

const mockGetConfig = vi.mocked(getConfig);

describe("getDispatcharrPublicUrl", () => {
  it("returns external URL when set", async () => {
    mockGetConfig.mockImplementation(async (key: string) => {
      if (key === "dispatcharr_external_url") return "https://external.example.com";
      if (key === "dispatcharr_url") return "http://internal.local:8000";
      return null;
    });

    const result = await getDispatcharrPublicUrl();
    expect(result).toBe("https://external.example.com");
  });

  it("falls back to internal URL when external is not set", async () => {
    mockGetConfig.mockImplementation(async (key: string) => {
      if (key === "dispatcharr_external_url") return null;
      if (key === "dispatcharr_url") return "https://internal.example.com";
      return null;
    });

    const result = await getDispatcharrPublicUrl();
    expect(result).toBe("https://internal.example.com");
  });

  it("falls back to internal URL when external is empty string", async () => {
    mockGetConfig.mockImplementation(async (key: string) => {
      if (key === "dispatcharr_external_url") return "";
      if (key === "dispatcharr_url") return "http://localhost:8000";
      return null;
    });

    const result = await getDispatcharrPublicUrl();
    expect(result).toBe("http://localhost:8000");
  });

  it("returns null when external URL is unsafe even if internal is configured", async () => {
    mockGetConfig.mockImplementation(async (key: string) => {
      if (key === "dispatcharr_external_url") return "http://public.example.com";
      if (key === "dispatcharr_url") return "https://internal.example.com";
      return null;
    });

    const result = await getDispatcharrPublicUrl();
    expect(result).toBeNull();
  });

  it("returns null when fallback internal URL is unsafe", async () => {
    mockGetConfig.mockImplementation(async (key: string) => {
      if (key === "dispatcharr_external_url") return "";
      if (key === "dispatcharr_url") return "http://internal.local:8000";
      return null;
    });

    const result = await getDispatcharrPublicUrl();
    expect(result).toBeNull();
  });

  it("returns null when neither URL is configured", async () => {
    mockGetConfig.mockImplementation(async () => null);

    const result = await getDispatcharrPublicUrl();
    expect(result).toBeNull();
  });
});
