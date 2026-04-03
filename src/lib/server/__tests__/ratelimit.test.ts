// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRateLimiter, loginLimiter, oauthLimiter, setupLimiter } from "../ratelimit";

describe("createRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests under the limit", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 3 });
    const result = limiter.check("ip-1");
    expect(result.allowed).toBe(true);
  });

  it("returns correct remaining count as requests accumulate", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 5 });

    expect(limiter.check("ip-1").remaining).toBe(4);
    expect(limiter.check("ip-1").remaining).toBe(3);
    expect(limiter.check("ip-1").remaining).toBe(2);
    expect(limiter.check("ip-1").remaining).toBe(1);
    expect(limiter.check("ip-1").remaining).toBe(0);
  });

  it("denies requests when limit is reached", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 2 });

    limiter.check("ip-1");
    limiter.check("ip-1");
    const result = limiter.check("ip-1");
    expect(result.allowed).toBe(false);
  });

  it("returns allowed: false with remaining: 0 when denied", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 1 });

    limiter.check("ip-1");
    const result = limiter.check("ip-1");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("allows requests again after window expires", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 2 });

    limiter.check("ip-1");
    limiter.check("ip-1");
    expect(limiter.check("ip-1").allowed).toBe(false);

    vi.advanceTimersByTime(60_001);

    const result = limiter.check("ip-1");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
  });

  it("tracks different keys independently", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 1 });

    limiter.check("ip-1");
    expect(limiter.check("ip-1").allowed).toBe(false);

    const result = limiter.check("ip-2");
    expect(result.allowed).toBe(true);
  });

  it("sets resetAt correctly (earliest timestamp + windowMs)", () => {
    vi.setSystemTime(1000);
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 3 });

    const r1 = limiter.check("ip-1");
    expect(r1.resetAt).toBe(1000 + 60_000);

    vi.advanceTimersByTime(5000);
    const r2 = limiter.check("ip-1");
    expect(r2.resetAt).toBe(1000 + 60_000);

    vi.advanceTimersByTime(5000);
    const r3 = limiter.check("ip-1");
    expect(r3.resetAt).toBe(1000 + 60_000);
  });

  it("reset(key) clears only that key's state", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 1 });

    limiter.check("ip-1");
    limiter.check("ip-2");
    expect(limiter.check("ip-1").allowed).toBe(false);
    expect(limiter.check("ip-2").allowed).toBe(false);

    limiter.reset("ip-1");

    expect(limiter.check("ip-1").allowed).toBe(true);
    expect(limiter.check("ip-2").allowed).toBe(false);
  });

  it("resetAll() clears all state", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 1 });

    limiter.check("ip-1");
    limiter.check("ip-2");
    expect(limiter.check("ip-1").allowed).toBe(false);
    expect(limiter.check("ip-2").allowed).toBe(false);

    limiter.resetAll();

    expect(limiter.check("ip-1").allowed).toBe(true);
    expect(limiter.check("ip-2").allowed).toBe(true);
  });

  it("evicts expired keys when store exceeds threshold", () => {
    vi.setSystemTime(1000);
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 1 });

    // Fill store above eviction threshold (1000 keys)
    for (let i = 0; i < 1001; i++) {
      limiter.check(`ip-${i}`);
    }

    // Advance time past the window so all entries expire
    vi.advanceTimersByTime(60_001);

    // Next check should trigger eviction and work normally
    const result = limiter.check("new-ip");
    expect(result.allowed).toBe(true);
  });
});

describe("pre-configured limiters", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupLimiter.resetAll();
    loginLimiter.resetAll();
    oauthLimiter.resetAll();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("setupLimiter allows 5, denies 6th", () => {
    for (let i = 0; i < 5; i++) {
      expect(setupLimiter.check("ip-1").allowed).toBe(true);
    }
    expect(setupLimiter.check("ip-1").allowed).toBe(false);
  });

  it("loginLimiter allows 10, denies 11th", () => {
    for (let i = 0; i < 10; i++) {
      expect(loginLimiter.check("ip-1").allowed).toBe(true);
    }
    expect(loginLimiter.check("ip-1").allowed).toBe(false);
  });

  it("oauthLimiter allows 20, denies 21st", () => {
    for (let i = 0; i < 20; i++) {
      expect(oauthLimiter.check("ip-1").allowed).toBe(true);
    }
    expect(oauthLimiter.check("ip-1").allowed).toBe(false);
  });
});
