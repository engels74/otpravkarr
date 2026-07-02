// @vitest-environment node

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { handleError } from "$lib/server/error-handler";

const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

afterEach(() => {
  consoleSpy.mockClear();
});

afterAll(() => {
  consoleSpy.mockRestore();
});

function createMockEvent(overrides?: {
  method?: string;
  pathname?: string;
  requestId?: string | null;
}) {
  const requestId = overrides && "requestId" in overrides ? overrides.requestId : "req-123";
  return {
    request: { method: overrides?.method ?? "GET" },
    url: { pathname: overrides?.pathname ?? "/boom" },
    locals: { requestId },
  } as unknown as Parameters<typeof handleError>[0]["event"];
}

function invoke(error: unknown) {
  return handleError({
    error,
    event: createMockEvent(),
    status: 500,
    message: "Internal Error",
  });
}

describe("handleError", () => {
  it("logs the real class/message/stack for an Error (never 'undefined')", () => {
    const err = new TypeError("cannot read property 'x' of null");
    const returned = invoke(err);

    expect(consoleSpy).toHaveBeenCalledOnce();
    const raw = (consoleSpy.mock.calls[0] as unknown[])[0] as string;
    expect(typeof raw).toBe("string");
    expect(raw).not.toContain("undefined");

    const entry = JSON.parse(raw);
    expect(entry.event).toBe("unhandled_error");
    expect(entry.requestId).toBe("req-123");
    expect(entry.method).toBe("GET");
    expect(entry.path).toBe("/boom");
    expect(entry.status).toBe(500);
    expect(entry.error).toMatchObject({
      name: "TypeError",
      message: "cannot read property 'x' of null",
    });
    expect(typeof entry.error.stack).toBe("string");

    // Client-facing body stays generic — no leakage of the internal message.
    expect(returned).toEqual({ message: "Internal Error" });
  });

  it("stringifies a non-Error throw instead of logging 'undefined'", () => {
    const returned = invoke("string blew up");

    const raw = (consoleSpy.mock.calls[0] as unknown[])[0] as string;
    const entry = JSON.parse(raw);
    expect(entry.error).toBe("string blew up");
    expect(entry.path).toBe("/boom");
    expect(returned).toEqual({ message: "Internal Error" });
  });

  it("tolerates a missing requestId", () => {
    handleError({
      error: new Error("no locals"),
      event: createMockEvent({ requestId: null }),
      status: 500,
      message: "Internal Error",
    });
    const raw = (consoleSpy.mock.calls[0] as unknown[])[0] as string;
    const entry = JSON.parse(raw);
    expect(entry.requestId).toBeNull();
  });
});
