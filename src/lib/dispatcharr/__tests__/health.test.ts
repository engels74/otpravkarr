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
const { createHealthEndpoints } = await import("../endpoints/health");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createClient() {
  return new DispatcharrClient("https://dispatch.example.com", "test-key");
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

describe("checkHealth", () => {
  it("returns reachable and authValid on 200", async () => {
    mockOfetch.mockResolvedValueOnce({
      count: 1,
      next: null,
      previous: null,
      results: [{ id: 1, username: "admin" }],
    });
    const endpoints = createHealthEndpoints(createClient());

    const result = await endpoints.checkHealth();

    expect(result).toEqual({
      ok: true,
      data: { reachable: true, authValid: true },
    });
    expect(mockOfetch).toHaveBeenCalledWith(
      "https://dispatch.example.com/api/accounts/users/?page=1&page_size=1",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns reachable but not authValid on 401", async () => {
    mockOfetch.mockRejectedValueOnce(makeFetchError(401, "Unauthorized"));
    const endpoints = createHealthEndpoints(createClient());

    const result = await endpoints.checkHealth();

    expect(result).toEqual({
      ok: true,
      data: { reachable: true, authValid: false },
    });
  });

  it("returns reachable but not authValid on 403", async () => {
    mockOfetch.mockRejectedValueOnce(makeFetchError(403, "Forbidden"));
    const endpoints = createHealthEndpoints(createClient());

    const result = await endpoints.checkHealth();

    expect(result).toEqual({
      ok: true,
      data: { reachable: true, authValid: false },
    });
  });

  it("returns not reachable on network error", async () => {
    mockOfetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const endpoints = createHealthEndpoints(createClient());

    const result = await endpoints.checkHealth();

    expect(result).toEqual({
      ok: true,
      data: { reachable: false, authValid: false },
    });
  });

  it("returns reachable but not authValid on 500 server error", async () => {
    mockOfetch.mockRejectedValueOnce(makeFetchError(500, "Internal Server Error"));
    const endpoints = createHealthEndpoints(createClient());

    const result = await endpoints.checkHealth();

    expect(result).toEqual({
      ok: true,
      data: { reachable: true, authValid: false },
    });
  });

  it("returns reachable but not authValid on 404", async () => {
    mockOfetch.mockRejectedValueOnce(makeFetchError(404, "Not Found"));
    const endpoints = createHealthEndpoints(createClient());

    const result = await endpoints.checkHealth();

    expect(result).toEqual({
      ok: true,
      data: { reachable: true, authValid: false },
    });
  });

  it("returns reachable but not authValid on unexpected response shape", async () => {
    // Server responds with 200 but unexpected JSON structure (e.g. different API version)
    mockOfetch.mockResolvedValueOnce({ unexpected: "data" });
    const endpoints = createHealthEndpoints(createClient());

    const result = await endpoints.checkHealth();

    expect(result).toEqual({
      ok: true,
      data: { reachable: true, authValid: false },
    });
  });
});
