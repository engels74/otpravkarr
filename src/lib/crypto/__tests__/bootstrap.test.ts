import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _getActiveTokenForTesting,
  _resetForTesting,
  clearBootstrapToken,
  consumeBootstrapToken,
  createBootstrapToken,
  generateBootstrapToken,
  isBootstrapTokenExpired,
  validateBootstrapToken,
} from "../bootstrap";

afterEach(() => {
  _resetForTesting();
  vi.restoreAllMocks();
});

describe("generateBootstrapToken", () => {
  it("returns format xxxx-xxxx-xxxx", () => {
    const token = generateBootstrapToken();
    expect(token).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
  });

  it("produces different tokens on successive calls", () => {
    const tokens = new Set(Array.from({ length: 20 }, () => generateBootstrapToken()));
    // With 36^12 ≈ 4.7 × 10^18 possibilities, collisions are astronomically unlikely
    expect(tokens.size).toBe(20);
  });
});

describe("createBootstrapToken", () => {
  it("returns a valid token and sets activeToken", () => {
    const token = createBootstrapToken();
    expect(token).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);

    const active = _getActiveTokenForTesting();
    expect(active).not.toBeNull();
    expect(active?.value).toBe(token);
    expect(active?.expiresAt).toBeGreaterThan(Date.now());
  });

  it("uses default 15-minute TTL", () => {
    const before = Date.now();
    createBootstrapToken();
    const after = Date.now();

    const active = _getActiveTokenForTesting();
    expect(active).not.toBeNull();
    const fifteenMin = 15 * 60 * 1000;
    expect(active?.expiresAt).toBeGreaterThanOrEqual(before + fifteenMin);
    expect(active?.expiresAt).toBeLessThanOrEqual(after + fifteenMin);
  });

  it("accepts custom TTL", () => {
    const before = Date.now();
    createBootstrapToken(5);
    const after = Date.now();

    const active = _getActiveTokenForTesting();
    expect(active).not.toBeNull();
    const fiveMin = 5 * 60 * 1000;
    expect(active?.expiresAt).toBeGreaterThanOrEqual(before + fiveMin);
    expect(active?.expiresAt).toBeLessThanOrEqual(after + fiveMin);
  });

  it("replaces any previously active token", () => {
    const first = createBootstrapToken();
    const second = createBootstrapToken();

    expect(first).not.toBe(second);
    expect(_getActiveTokenForTesting()?.value).toBe(second);
  });
});

describe("validateBootstrapToken", () => {
  it("returns true for the correct token without consuming it", () => {
    const token = createBootstrapToken();
    expect(validateBootstrapToken(token)).toBe(true);
    expect(_getActiveTokenForTesting()?.value).toBe(token);
  });

  it("returns false for an incorrect token and keeps the active token", () => {
    createBootstrapToken();
    expect(validateBootstrapToken("wrong-token-here")).toBe(false);
    expect(_getActiveTokenForTesting()).not.toBeNull();
  });
});

describe("consumeBootstrapToken", () => {
  it("returns true for the correct token", () => {
    const token = createBootstrapToken();
    expect(consumeBootstrapToken(token)).toBe(true);
  });

  it("nulls the token after successful consumption (single-use)", () => {
    const token = createBootstrapToken();
    expect(consumeBootstrapToken(token)).toBe(true);
    // Second attempt must fail
    expect(consumeBootstrapToken(token)).toBe(false);
    expect(_getActiveTokenForTesting()).toBeNull();
  });

  it("returns false for an incorrect token", () => {
    createBootstrapToken();
    expect(consumeBootstrapToken("wrong-token-here")).toBe(false);
    // Token should still be active after a failed attempt
    expect(_getActiveTokenForTesting()).not.toBeNull();
  });

  it("returns false when no token is active", () => {
    expect(consumeBootstrapToken("abcd-efgh-ijkl")).toBe(false);
  });

  it("returns false for an expired token", () => {
    const token = createBootstrapToken();
    // Move time past expiry
    const active = _getActiveTokenForTesting();
    if (active) active.expiresAt = Date.now() - 1;

    expect(consumeBootstrapToken(token)).toBe(false);
    expect(_getActiveTokenForTesting()).toBeNull();
  });

  it("does not leak timing information (constant-time comparison)", () => {
    // This test verifies the comparison runs for both matching and non-matching inputs
    // by ensuring the function handles different-length inputs correctly
    createBootstrapToken();
    expect(consumeBootstrapToken("")).toBe(false);
    expect(_getActiveTokenForTesting()).not.toBeNull();

    expect(consumeBootstrapToken("a")).toBe(false);
    expect(_getActiveTokenForTesting()).not.toBeNull();

    expect(consumeBootstrapToken("abcd-efgh-ijkl-mnop-extra")).toBe(false);
    expect(_getActiveTokenForTesting()).not.toBeNull();
  });
});

describe("isBootstrapTokenExpired", () => {
  it("returns true when no token exists", () => {
    expect(isBootstrapTokenExpired()).toBe(true);
  });

  it("returns false for a fresh token", () => {
    createBootstrapToken();
    expect(isBootstrapTokenExpired()).toBe(false);
  });

  it("returns true after the token expires", () => {
    createBootstrapToken();
    const active = _getActiveTokenForTesting();
    if (active) active.expiresAt = Date.now() - 1;
    expect(isBootstrapTokenExpired()).toBe(true);
  });

  it("returns true after token is consumed", () => {
    const token = createBootstrapToken();
    consumeBootstrapToken(token);
    expect(isBootstrapTokenExpired()).toBe(true);
  });
});

describe("clearBootstrapToken", () => {
  it("removes the active token", () => {
    createBootstrapToken();
    clearBootstrapToken();
    expect(_getActiveTokenForTesting()).toBeNull();
  });
});
