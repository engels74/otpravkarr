// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequestLogger } from "$lib/server/logging";

const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

afterEach(() => {
  consoleSpy.mockClear();
});

function createMockEvent(overrides?: Partial<{ method: string; pathname: string; ip: string }>) {
  return {
    request: { method: overrides?.method ?? "GET" },
    url: { pathname: overrides?.pathname ?? "/test" },
    getClientAddress: () => overrides?.ip ?? "127.0.0.1",
  } as Parameters<Awaited<ReturnType<typeof createRequestLogger>>>[0]["event"];
}

const mockResolve = async () => new Response(null, { status: 200 });

describe("createRequestLogger", () => {
  it("logs a JSON string to console.log", async () => {
    const handler = createRequestLogger();
    await handler({ event: createMockEvent(), resolve: mockResolve });

    expect(consoleSpy).toHaveBeenCalledOnce();
    expect(typeof consoleSpy.mock.calls[0]![0]).toBe("string");
  });

  it("logged JSON is parseable and contains all required fields", async () => {
    const handler = createRequestLogger();
    await handler({ event: createMockEvent(), resolve: mockResolve });

    const raw = consoleSpy.mock.calls[0]![0] as string;
    const entry = JSON.parse(raw);

    expect(entry).toHaveProperty("timestamp");
    expect(entry).toHaveProperty("method");
    expect(entry).toHaveProperty("path");
    expect(entry).toHaveProperty("status");
    expect(entry).toHaveProperty("duration_ms");
    expect(entry).toHaveProperty("ip");
  });

  it("method matches the request method", async () => {
    const handler = createRequestLogger();
    await handler({ event: createMockEvent({ method: "POST" }), resolve: mockResolve });

    const entry = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
    expect(entry.method).toBe("POST");
  });

  it("path matches the URL pathname", async () => {
    const handler = createRequestLogger();
    await handler({ event: createMockEvent({ pathname: "/api/data" }), resolve: mockResolve });

    const entry = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
    expect(entry.path).toBe("/api/data");
  });

  it("status matches the response status", async () => {
    const handler = createRequestLogger();
    await handler({
      event: createMockEvent(),
      resolve: async () => new Response(null, { status: 201 }),
    });

    const entry = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
    expect(entry.status).toBe(201);
  });

  it("IP matches getClientAddress() return value", async () => {
    const handler = createRequestLogger();
    await handler({ event: createMockEvent({ ip: "192.168.1.100" }), resolve: mockResolve });

    const entry = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
    expect(entry.ip).toBe("192.168.1.100");
  });

  it("duration is a non-negative number", async () => {
    const handler = createRequestLogger();
    await handler({ event: createMockEvent(), resolve: mockResolve });

    const entry = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
    expect(typeof entry.duration_ms).toBe("number");
    expect(entry.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("timestamp is a valid ISO 8601 string", async () => {
    const handler = createRequestLogger();
    await handler({ event: createMockEvent(), resolve: mockResolve });

    const entry = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
    const parsed = new Date(entry.timestamp);
    expect(parsed.toISOString()).toBe(entry.timestamp);
  });

  it("returns the response from resolve unchanged", async () => {
    const handler = createRequestLogger();
    const expected = new Response(null, { status: 200 });
    const result = await handler({
      event: createMockEvent(),
      resolve: async () => expected,
    });

    expect(result).toBe(expected);
  });

  it("handles 404 status code", async () => {
    const handler = createRequestLogger();
    await handler({
      event: createMockEvent(),
      resolve: async () => new Response(null, { status: 404 }),
    });

    const entry = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
    expect(entry.status).toBe(404);
  });

  it("handles 500 status code", async () => {
    const handler = createRequestLogger();
    await handler({
      event: createMockEvent(),
      resolve: async () => new Response(null, { status: 500 }),
    });

    const entry = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
    expect(entry.status).toBe(500);
  });
});
