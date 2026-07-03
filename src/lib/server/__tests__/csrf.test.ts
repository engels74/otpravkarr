// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@sveltejs/kit", () => ({
  error: (status: number, message: string) => {
    throw { status, body: { message } };
  },
}));

const { validateOrigin } = await import("$lib/server/csrf");

function makeRequest(method: string, origin?: string): Request {
  const headers: Record<string, string> = {};
  if (origin !== undefined) {
    headers.Origin = origin;
  }
  return new Request("http://localhost", { method, headers });
}

describe("validateOrigin", () => {
  it("passes GET requests without validation", () => {
    expect(() => validateOrigin(makeRequest("GET"), ["http://example.com"])).not.toThrow();
  });

  it("passes HEAD requests without validation", () => {
    expect(() => validateOrigin(makeRequest("HEAD"), ["http://example.com"])).not.toThrow();
  });

  it("passes OPTIONS requests without validation", () => {
    expect(() => validateOrigin(makeRequest("OPTIONS"), ["http://example.com"])).not.toThrow();
  });

  it("passes when allowedOrigins is empty (setup incomplete)", () => {
    expect(() => validateOrigin(makeRequest("POST"), [])).not.toThrow();
  });

  it("throws 403 on POST with missing Origin header", () => {
    expect(() => validateOrigin(makeRequest("POST"), ["http://example.com"])).toThrow();
    try {
      validateOrigin(makeRequest("POST"), ["http://example.com"]);
    } catch (e: unknown) {
      const err = e as { status: number; body: { message: string } };
      expect(err.status).toBe(403);
      expect(err.body.message).toBe("missing origin header");
    }
  });

  it("throws 403 on PUT with missing Origin header", () => {
    expect(() => validateOrigin(makeRequest("PUT"), ["http://example.com"])).toThrow();
  });

  it("throws 403 on PATCH with missing Origin header", () => {
    expect(() => validateOrigin(makeRequest("PATCH"), ["http://example.com"])).toThrow();
  });

  it("throws 403 on DELETE with missing Origin header", () => {
    expect(() => validateOrigin(makeRequest("DELETE"), ["http://example.com"])).toThrow();
  });

  it("throws 403 on POST with mismatched Origin", () => {
    expect(() =>
      validateOrigin(makeRequest("POST", "http://evil.com"), ["http://example.com"]),
    ).toThrow();
    try {
      validateOrigin(makeRequest("POST", "http://evil.com"), ["http://example.com"]);
    } catch (e: unknown) {
      const err = e as { status: number; body: { message: string } };
      expect(err.status).toBe(403);
      expect(err.body.message).toBe("origin not allowed");
    }
  });

  it("throws 403 on forged cross-origin internal API origins", () => {
    try {
      validateOrigin(makeRequest("POST", "http://evil.example"), ["http://localhost:3000"]);
      expect.unreachable("should have thrown");
    } catch (e: unknown) {
      const err = e as { status: number; body: { message: string } };
      expect(err.status).toBe(403);
      expect(err.body.message).toBe("origin not allowed");
    }
  });

  it("passes POST with matching Origin", () => {
    expect(() =>
      validateOrigin(makeRequest("POST", "http://example.com"), ["http://example.com"]),
    ).not.toThrow();
  });

  it("normalizes trailing slash on Origin header", () => {
    expect(() =>
      validateOrigin(makeRequest("POST", "http://example.com/"), ["http://example.com"]),
    ).not.toThrow();
  });

  it("normalizes trailing slash on allowed origins", () => {
    expect(() =>
      validateOrigin(makeRequest("POST", "http://example.com"), ["http://example.com/"]),
    ).not.toThrow();
  });

  it("matches second entry in multiple allowed origins", () => {
    expect(() =>
      validateOrigin(makeRequest("POST", "http://second.com"), [
        "http://first.com",
        "http://second.com",
      ]),
    ).not.toThrow();
  });

  it("performs case-insensitive comparison", () => {
    expect(() =>
      validateOrigin(makeRequest("POST", "http://Example.com"), ["http://example.com"]),
    ).not.toThrow();
  });

  it("canonicalizes explicit http default port (:80) on Origin header", () => {
    expect(() =>
      validateOrigin(makeRequest("POST", "http://example.com:80"), ["http://example.com"]),
    ).not.toThrow();
  });

  it("canonicalizes explicit http default port (:80) on allowed origin", () => {
    expect(() =>
      validateOrigin(makeRequest("POST", "http://example.com"), ["http://example.com:80"]),
    ).not.toThrow();
  });

  it("canonicalizes explicit https default port (:443) on Origin header", () => {
    expect(() =>
      validateOrigin(makeRequest("POST", "https://example.com:443"), ["https://example.com"]),
    ).not.toThrow();
  });

  it("canonicalizes explicit https default port (:443) on allowed origin", () => {
    expect(() =>
      validateOrigin(makeRequest("POST", "https://example.com"), ["https://example.com:443"]),
    ).not.toThrow();
  });

  it("throws 403 with 'invalid Origin header' on Origin: null", () => {
    try {
      validateOrigin(makeRequest("POST", "null"), ["http://example.com"]);
      expect.unreachable("should have thrown");
    } catch (e: unknown) {
      const err = e as { status: number; body: { message: string } };
      expect(err.status).toBe(403);
      expect(err.body.message).toBe("invalid origin header");
    }
  });

  it("throws 403 with 'invalid Origin header' on malformed Origin", () => {
    try {
      validateOrigin(makeRequest("POST", "not-a-url"), ["http://example.com"]);
      expect.unreachable("should have thrown");
    } catch (e: unknown) {
      const err = e as { status: number; body: { message: string } };
      expect(err.status).toBe(403);
      expect(err.body.message).toBe("invalid origin header");
    }
  });
});
