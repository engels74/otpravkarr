import { describe, expect, it, vi } from "vitest";

import {
  computeDelay,
  DEFAULT_RETRY_CONFIG,
  isTransientPlexError,
  isTransientResultError,
  retryAsync,
  retryResult,
} from "../retry";

// ---------------------------------------------------------------------------
// computeDelay
// ---------------------------------------------------------------------------

describe("computeDelay", () => {
  const config = { ...DEFAULT_RETRY_CONFIG, jitter: 0 };

  it("gives deterministic delays when jitter is 0", () => {
    expect(computeDelay(0, config)).toBe(1_000);
    expect(computeDelay(1, config)).toBe(2_000);
    expect(computeDelay(2, config)).toBe(4_000);
  });

  it("doubles delay per attempt", () => {
    const d0 = computeDelay(0, config);
    const d1 = computeDelay(1, config);
    const d2 = computeDelay(2, config);
    expect(d1).toBe(d0 * 2);
    expect(d2).toBe(d1 * 2);
  });

  it("caps at maxDelayMs", () => {
    const small = { ...config, maxDelayMs: 3_000 };
    expect(computeDelay(0, small)).toBe(1_000);
    expect(computeDelay(1, small)).toBe(2_000);
    expect(computeDelay(2, small)).toBe(3_000); // capped
    expect(computeDelay(10, small)).toBe(3_000); // still capped
  });

  it("returns 0 when full jitter and random returns 0", () => {
    const full = { ...DEFAULT_RETRY_CONFIG, jitter: 1 };
    expect(computeDelay(0, full, () => 0)).toBe(0);
    expect(computeDelay(3, full, () => 0)).toBe(0);
  });

  it("blends fixed and jittered portions with partial jitter", () => {
    const partial = { ...DEFAULT_RETRY_CONFIG, jitter: 0.5 };
    // attempt 0: raw = 1000, fixed = 500, jittered = 500 * 0.75 = 375
    const delay = computeDelay(0, partial, () => 0.75);
    expect(delay).toBe(Math.floor(500 + 375));
  });
});

// ---------------------------------------------------------------------------
// retryAsync
// ---------------------------------------------------------------------------

describe("retryAsync", () => {
  it("returns on first success", async () => {
    const fn = vi.fn().mockResolvedValueOnce("ok");
    const result = await retryAsync(fn, undefined, { maxRetries: 3, baseDelayMs: 0 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries and succeeds on a later attempt", async () => {
    vi.useFakeTimers();
    try {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("fail1"))
        .mockRejectedValueOnce(new Error("fail2"))
        .mockResolvedValueOnce("ok");

      const promise = retryAsync(fn, undefined, { maxRetries: 3, baseDelayMs: 100, jitter: 0 });
      // advance past attempt 0 delay (100ms) and attempt 1 delay (200ms)
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(200);
      const result = await promise;
      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws immediately when shouldRetry returns false", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("fatal"));
    const shouldRetry = vi.fn().mockReturnValue(false);

    await expect(retryAsync(fn, shouldRetry, { maxRetries: 3, baseDelayMs: 0 })).rejects.toThrow(
      "fatal",
    );
    expect(fn).toHaveBeenCalledTimes(1);
    expect(shouldRetry).toHaveBeenCalledTimes(1);
  });

  it("throws last error after exhaustion", async () => {
    vi.useFakeTimers();
    try {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("e1"))
        .mockRejectedValueOnce(new Error("e2"))
        .mockRejectedValueOnce(new Error("last"));

      const promise = retryAsync(fn, undefined, { maxRetries: 2, baseDelayMs: 50, jitter: 0 });
      // Attach a catch handler early to prevent unhandled rejection
      const resultPromise = promise.catch((e) => e);
      // advance past attempt 0 delay (50ms) and attempt 1 delay (100ms)
      await vi.advanceTimersByTimeAsync(50);
      await vi.advanceTimersByTimeAsync(100);
      const caught = await resultPromise;
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe("last");
      expect(fn).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clamps negative maxRetries to 0 and calls fn once", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("fail"));
    await expect(retryAsync(fn, undefined, { maxRetries: -5, baseDelayMs: 0 })).rejects.toThrow(
      "fail",
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries all errors when shouldRetry is omitted", async () => {
    vi.useFakeTimers();
    try {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("a"))
        .mockRejectedValueOnce(new Error("b"))
        .mockResolvedValueOnce("ok");

      const promise = retryAsync(fn, undefined, { maxRetries: 3, baseDelayMs: 10, jitter: 0 });
      await vi.advanceTimersByTimeAsync(10);
      await vi.advanceTimersByTimeAsync(20);
      const result = await promise;
      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// retryResult
// ---------------------------------------------------------------------------

describe("retryResult", () => {
  type OkResult = { ok: true; data: string };
  type ErrResult = { ok: false; error: string; message: string };
  type Result = OkResult | ErrResult;

  const shouldRetry = (r: Result & { ok: false }) => r.error === "network_error";

  it("returns immediately on success", async () => {
    const fn = vi.fn<() => Promise<Result>>().mockResolvedValueOnce({ ok: true, data: "hello" });
    const result = await retryResult(fn, shouldRetry, { maxRetries: 3, baseDelayMs: 0 });
    expect(result).toEqual({ ok: true, data: "hello" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries transient errors and succeeds", async () => {
    vi.useFakeTimers();
    try {
      const fn = vi
        .fn<() => Promise<Result>>()
        .mockResolvedValueOnce({ ok: false, error: "network_error", message: "timeout" })
        .mockResolvedValueOnce({ ok: true, data: "recovered" });

      const promise = retryResult(fn, shouldRetry, {
        maxRetries: 3,
        baseDelayMs: 100,
        jitter: 0,
      });
      await vi.advanceTimersByTimeAsync(100);
      const result = await promise;
      expect(result).toEqual({ ok: true, data: "recovered" });
      expect(fn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry non-transient errors", async () => {
    const fn = vi
      .fn<() => Promise<Result>>()
      .mockResolvedValueOnce({ ok: false, error: "auth_failure", message: "bad key" });

    const result = await retryResult(fn, shouldRetry, { maxRetries: 3, baseDelayMs: 0 });
    expect(result).toEqual({ ok: false, error: "auth_failure", message: "bad key" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("clamps negative maxRetries to 0 and calls fn once", async () => {
    const fn = vi
      .fn<() => Promise<Result>>()
      .mockResolvedValueOnce({ ok: false, error: "network_error", message: "only" });
    const result = await retryResult(fn, shouldRetry, { maxRetries: -3, baseDelayMs: 0 });
    expect(result).toEqual({ ok: false, error: "network_error", message: "only" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("returns last failed result after exhaustion", async () => {
    vi.useFakeTimers();
    try {
      const fn = vi
        .fn<() => Promise<Result>>()
        .mockResolvedValueOnce({ ok: false, error: "network_error", message: "t1" })
        .mockResolvedValueOnce({ ok: false, error: "network_error", message: "t2" })
        .mockResolvedValueOnce({ ok: false, error: "network_error", message: "last" });

      const promise = retryResult(fn, shouldRetry, {
        maxRetries: 2,
        baseDelayMs: 50,
        jitter: 0,
      });
      await vi.advanceTimersByTimeAsync(50);
      await vi.advanceTimersByTimeAsync(100);
      const result = await promise;
      expect(result).toEqual({ ok: false, error: "network_error", message: "last" });
      expect(fn).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// isTransientResultError
// ---------------------------------------------------------------------------

describe("isTransientResultError", () => {
  it("returns false when retryable is explicitly false", () => {
    expect(isTransientResultError({ error: "network_error", retryable: false })).toBe(false);
    expect(isTransientResultError({ error: "server_error", retryable: false })).toBe(false);
  });

  it("returns true for network_error", () => {
    expect(isTransientResultError({ error: "network_error" })).toBe(true);
  });

  it("returns true for server_error", () => {
    expect(isTransientResultError({ error: "server_error" })).toBe(true);
  });

  it.each([
    "auth_failure",
    "not_found",
    "validation_error",
    "unexpected_shape",
  ])("returns false for %s", (code) => {
    expect(isTransientResultError({ error: code })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isTransientPlexError
// ---------------------------------------------------------------------------

describe("isTransientPlexError", () => {
  it("returns false for PlexAuthError (by name)", () => {
    const err = new Error("auth failed");
    err.name = "PlexAuthError";
    expect(isTransientPlexError(err)).toBe(false);
  });

  it("returns true for PlexConnectionError", () => {
    const err = new Error("connection failed");
    err.name = "PlexConnectionError";
    expect(isTransientPlexError(err)).toBe(true);
  });

  it("returns true for generic Error", () => {
    expect(isTransientPlexError(new Error("something"))).toBe(true);
  });

  it("returns true for non-Error values", () => {
    expect(isTransientPlexError("string error")).toBe(true);
    expect(isTransientPlexError(42)).toBe(true);
    expect(isTransientPlexError(null)).toBe(true);
    expect(isTransientPlexError(undefined)).toBe(true);
  });

  it("returns true for PlexAuthError wrapping the plex-api network signature", () => {
    const err = new Error(
      "OAuth initiation failed: Unable to connect. Is the computer able to access the url?",
    );
    err.name = "PlexAuthError";
    expect(isTransientPlexError(err)).toBe(true);
  });

  it("returns true for plain Error carrying the plex-api network signature", () => {
    expect(
      isTransientPlexError(new Error("Unable to connect. Is the computer able to access the url?")),
    ).toBe(true);
  });

  it("returns false for PlexAuthError with a non-transient message", () => {
    const err = new Error("OAuth initiation failed: unauthorized");
    err.name = "PlexAuthError";
    expect(isTransientPlexError(err)).toBe(false);
  });
});
