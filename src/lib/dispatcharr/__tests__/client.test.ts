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

function makeFetchError(statusCode: number, message = "Error", data?: unknown) {
  const err = new Error(message) as Error & {
    statusCode: number;
    statusMessage: string;
    data?: unknown;
  };
  err.statusCode = statusCode;
  err.statusMessage = message;
  if (data !== undefined) {
    err.data = data;
  }
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

  it("strips absolute URL to path when passed as path argument", async () => {
    mockOfetch.mockResolvedValueOnce({ id: 1 });
    const client = createClient("https://dispatch.example.com");

    await client.request("GET", "https://other.host.com/api/test/?page=2");

    expect(mockOfetch).toHaveBeenCalledWith(
      "https://dispatch.example.com/api/test/?page=2",
      expect.any(Object),
    );
  });

  it("returns validation_error for malformed absolute URLs", async () => {
    const client = createClient();

    const result = await client.request("GET", "http://[invalid");

    expect(result).toEqual({
      ok: false,
      error: "validation_error",
      message: "Invalid URL path: http://[invalid",
    });
    expect(mockOfetch).not.toHaveBeenCalled();
  });

  it("sends ApiKey authorization header", async () => {
    mockOfetch.mockResolvedValueOnce({ id: 1 });
    const client = createClient("https://dispatch.example.com", "my-api-key");

    await client.request("GET", "/api/test/");

    expect(mockOfetch).toHaveBeenCalledWith("https://dispatch.example.com/api/test/", {
      method: "GET",
      timeout: 15_000,
      retry: 1,
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

  it("maps 500 to server_error", async () => {
    mockOfetch.mockRejectedValueOnce(makeFetchError(500, "Internal Server Error"));
    const client = createClient();

    const result = await client.request("GET", "/api/resource/");

    expect(result).toEqual({
      ok: false,
      error: "server_error",
      message: "Internal Server Error",
    });
  });

  it("marks 5xx mutation errors as non-retryable", async () => {
    mockOfetch.mockRejectedValueOnce(makeFetchError(500, "Internal Server Error"));
    const client = createClient();

    const result = await client.request("PATCH", "/api/resource/1/", { body: { x: 1 } });

    expect(result).toEqual({
      ok: false,
      error: "server_error",
      message: "Internal Server Error",
      retryable: false,
    });
  });

  it("maps 502 to server_error", async () => {
    mockOfetch.mockRejectedValueOnce(makeFetchError(502, "Bad Gateway"));
    const client = createClient();

    const result = await client.request("GET", "/api/resource/");

    expect(result).toEqual({
      ok: false,
      error: "server_error",
      message: "Bad Gateway",
    });
  });

  it("maps network errors (no statusCode) to network_error", async () => {
    mockOfetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const client = createClient();

    const result = await client.request("GET", "/api/resource/");

    expect(result).toEqual({ ok: false, error: "network_error", message: "ECONNREFUSED" });
  });

  it("marks network mutation errors as non-retryable", async () => {
    mockOfetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const client = createClient();

    const result = await client.request("POST", "/api/resource/", { body: { x: 1 } });

    expect(result).toEqual({
      ok: false,
      error: "network_error",
      message: "ECONNREFUSED",
      retryable: false,
    });
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

  it("does not expose raw response body in error message", async () => {
    const sensitiveData = { detail: "Internal DB error at row 42", stack: "..." };
    mockOfetch.mockRejectedValueOnce(makeFetchError(500, "Internal Server Error", sensitiveData));
    const client = createClient();

    const result = await client.request("GET", "/api/resource/");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("Internal Server Error");
      expect(result.message).not.toContain("DB error");
      expect(result.message).not.toContain("row 42");
    }
  });

  it("logs redacted response body metadata to console.error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const responseBody = { detail: "user not found in external system" };
    mockOfetch.mockRejectedValueOnce(makeFetchError(404, "Not Found", responseBody));
    const client = createClient();

    await client.request("GET", "/api/resource/999/");

    const serializedLength = JSON.stringify(responseBody)?.length ?? 0;
    expect(errorSpy).toHaveBeenCalledWith(
      `[dispatcharr] 404: [redacted object response body; ${serializedLength} chars]`,
    );
    errorSpy.mockRestore();
  });

  it("logs unserializable response bodies without throwing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const responseBody: { detail: string; self?: unknown } = { detail: "circular" };
    responseBody.self = responseBody;
    mockOfetch.mockRejectedValueOnce(makeFetchError(500, "Internal Server Error", responseBody));
    const client = createClient();

    try {
      const result = await client.request("GET", "/api/resource/999/");

      expect(result).toEqual({
        ok: false,
        error: "server_error",
        message: "Internal Server Error",
      });
      expect(errorSpy).toHaveBeenCalledWith(
        "[dispatcharr] 500: [redacted object response body; unserializable]",
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("never leaks raw exceptions to callers", async () => {
    mockOfetch.mockRejectedValueOnce(new TypeError("fetch failed"));
    const client = createClient();

    // Should not throw — returns a result
    const result = await client.request("GET", "/api/resource/");

    expect(result.ok).toBe(false);
  });

  it("passes timeout: 15_000 on all requests", async () => {
    mockOfetch.mockResolvedValueOnce({});
    const client = createClient();

    await client.request("POST", "/api/resource/", { body: { x: 1 } });

    expect(mockOfetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: 15_000 }),
    );
  });

  it("passes retry: 1 for GET requests", async () => {
    mockOfetch.mockResolvedValueOnce({});
    const client = createClient();

    await client.request("GET", "/api/resource/");

    expect(mockOfetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ retry: 1 }),
    );
  });

  it("passes retry: 1 for HEAD requests", async () => {
    mockOfetch.mockResolvedValueOnce({});
    const client = createClient();

    await client.request("HEAD", "/api/resource/");

    expect(mockOfetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ retry: 1 }),
    );
  });

  it("passes retry: 0 for POST requests", async () => {
    mockOfetch.mockResolvedValueOnce({});
    const client = createClient();

    await client.request("POST", "/api/resource/", { body: {} });

    expect(mockOfetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ retry: 0 }),
    );
  });

  it("passes retry: 0 for PATCH requests", async () => {
    mockOfetch.mockResolvedValueOnce({});
    const client = createClient();

    await client.request("PATCH", "/api/resource/1/", { body: {} });

    expect(mockOfetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ retry: 0 }),
    );
  });

  it("passes retry: 0 for PUT requests", async () => {
    mockOfetch.mockResolvedValueOnce({});
    const client = createClient();

    await client.request("PUT", "/api/resource/1/", { body: {} });

    expect(mockOfetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ retry: 0 }),
    );
  });

  it("passes retry: 0 for DELETE requests", async () => {
    mockOfetch.mockResolvedValueOnce({});
    const client = createClient();

    await client.request("DELETE", "/api/resource/1/");

    expect(mockOfetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ retry: 0 }),
    );
  });
});
