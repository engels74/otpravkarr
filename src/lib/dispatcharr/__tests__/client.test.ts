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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createClient(baseUrl = "https://dispatch.example.com", apiKey = "test-key-123") {
  return new DispatcharrClient(baseUrl, apiKey);
}

function makeFetchError(statusCode: number, message = "Error") {
  const err = new Error(message) as Error & { statusCode: number; statusMessage: string };
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

describe("DispatcharrClient constructor", () => {
  it("strips trailing slash from baseUrl", () => {
    const client = createClient("https://dispatch.example.com/");
    expect(client.baseUrl).toBe("https://dispatch.example.com");
  });

  it("keeps baseUrl unchanged when no trailing slash", () => {
    const client = createClient("https://dispatch.example.com");
    expect(client.baseUrl).toBe("https://dispatch.example.com");
  });
});

describe("DispatcharrClient.request", () => {
  it("normalizes path without leading slash", async () => {
    mockOfetch.mockResolvedValueOnce({ id: 1 });
    const client = createClient("https://dispatch.example.com");

    await client.request("GET", "api/test/");

    expect(mockOfetch).toHaveBeenCalledWith(
      "https://dispatch.example.com/api/test/",
      expect.any(Object),
    );
  });

  it("sends ApiKey authorization header", async () => {
    mockOfetch.mockResolvedValueOnce({ id: 1 });
    const client = createClient("https://dispatch.example.com", "my-api-key");

    await client.request("GET", "/api/test/");

    expect(mockOfetch).toHaveBeenCalledWith("https://dispatch.example.com/api/test/", {
      method: "GET",
      headers: { Authorization: "ApiKey my-api-key" },
    });
  });

  it("returns ok result with data on success", async () => {
    const payload = { id: 1, name: "test" };
    mockOfetch.mockResolvedValueOnce(payload);
    const client = createClient();

    const result = await client.request("GET", "/api/resource/1/");

    expect(result).toEqual({ ok: true, data: payload });
  });

  it("sends body for POST requests", async () => {
    const body = { username: "user1", password: "pass123" };
    mockOfetch.mockResolvedValueOnce({ id: 1 });
    const client = createClient();

    await client.request("POST", "/api/accounts/users/", { body });

    expect(mockOfetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: "POST", body }),
    );
  });

  it("validates response with schema on success", async () => {
    const schema = z.object({ id: z.number(), name: z.string() });
    mockOfetch.mockResolvedValueOnce({ id: 1, name: "test" });
    const client = createClient();

    const result = await client.request("GET", "/api/resource/1/", { schema });

    expect(result).toEqual({ ok: true, data: { id: 1, name: "test" } });
  });

  it("returns unexpected_shape when schema validation fails", async () => {
    const schema = z.object({ id: z.number(), name: z.string() });
    mockOfetch.mockResolvedValueOnce({ id: "not-a-number", name: 42 });
    const client = createClient();

    const result = await client.request("GET", "/api/resource/1/", { schema });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("unexpected_shape");
      expect(result.message).toBeTruthy();
    }
  });

  it("maps 401 to auth_failure", async () => {
    mockOfetch.mockRejectedValueOnce(makeFetchError(401, "Unauthorized"));
    const client = createClient();

    const result = await client.request("GET", "/api/protected/");

    expect(result).toEqual({ ok: false, error: "auth_failure", message: "Unauthorized" });
  });

  it("maps 403 to auth_failure", async () => {
    mockOfetch.mockRejectedValueOnce(makeFetchError(403, "Forbidden"));
    const client = createClient();

    const result = await client.request("GET", "/api/admin/");

    expect(result).toEqual({ ok: false, error: "auth_failure", message: "Forbidden" });
  });

  it("maps 404 to not_found", async () => {
    mockOfetch.mockRejectedValueOnce(makeFetchError(404, "Not Found"));
    const client = createClient();

    const result = await client.request("GET", "/api/resource/999/");

    expect(result).toEqual({ ok: false, error: "not_found", message: "Not Found" });
  });

  it("maps 400 to validation_error", async () => {
    mockOfetch.mockRejectedValueOnce(makeFetchError(400, "Bad Request"));
    const client = createClient();

    const result = await client.request("POST", "/api/resource/");

    expect(result).toEqual({ ok: false, error: "validation_error", message: "Bad Request" });
  });

  it("maps 422 to validation_error", async () => {
    mockOfetch.mockRejectedValueOnce(makeFetchError(422, "Unprocessable Entity"));
    const client = createClient();

    const result = await client.request("POST", "/api/resource/");

    expect(result).toEqual({
      ok: false,
      error: "validation_error",
      message: "Unprocessable Entity",
    });
  });

  it("maps 500 to network_error", async () => {
    mockOfetch.mockRejectedValueOnce(makeFetchError(500, "Internal Server Error"));
    const client = createClient();

    const result = await client.request("GET", "/api/resource/");

    expect(result).toEqual({
      ok: false,
      error: "network_error",
      message: "Internal Server Error",
    });
  });

  it("maps network errors (no statusCode) to network_error", async () => {
    mockOfetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const client = createClient();

    const result = await client.request("GET", "/api/resource/");

    expect(result).toEqual({ ok: false, error: "network_error", message: "ECONNREFUSED" });
  });

  it("maps non-Error thrown values to network_error", async () => {
    mockOfetch.mockRejectedValueOnce("unexpected string");
    const client = createClient();

    const result = await client.request("GET", "/api/resource/");

    expect(result).toEqual({
      ok: false,
      error: "network_error",
      message: "unexpected string",
    });
  });

  it("never leaks raw exceptions to callers", async () => {
    mockOfetch.mockRejectedValueOnce(new TypeError("fetch failed"));
    const client = createClient();

    // Should not throw — returns a result
    const result = await client.request("GET", "/api/resource/");

    expect(result.ok).toBe(false);
  });
});
