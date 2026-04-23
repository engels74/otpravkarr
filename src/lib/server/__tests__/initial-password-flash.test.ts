// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  decryptValue: "" as string,
}));

const mocks = vi.hoisted(() => ({
  encrypt: vi.fn(async (_plaintext: string, _purpose: string) => "sealed-flash"),
  decrypt: vi.fn(async (_sealed: string, _purpose: string) => state.decryptValue),
}));

vi.mock("$lib/crypto/encryption", () => ({
  encrypt: mocks.encrypt,
  decrypt: mocks.decrypt,
}));

describe("initial password flash", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T12:00:00Z"));
    state.decryptValue = JSON.stringify({
      password: "TempPassword!23",
      expiresAt: Date.now() + 120_000,
    });
    mocks.encrypt.mockClear();
    mocks.decrypt.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("seals password payload with purpose-specific encryption", async () => {
    const { sealInitialPasswordFlash } = await import("../initial-password-flash");

    const sealed = await sealInitialPasswordFlash("TempPassword!23");

    expect(sealed).toBe("sealed-flash");
    expect(mocks.encrypt).toHaveBeenCalledWith(expect.any(String), "initial-password-flash");
    const payload = JSON.parse(mocks.encrypt.mock.calls[0]?.[0] ?? "{}") as {
      password?: string;
      expiresAt?: number;
    };
    expect(payload).toEqual({
      password: "TempPassword!23",
      expiresAt: Date.now() + 120_000,
    });
  });

  it("opens a valid password payload", async () => {
    const { openInitialPasswordFlash } = await import("../initial-password-flash");

    const password = await openInitialPasswordFlash("sealed-flash");

    expect(password).toBe("TempPassword!23");
    expect(mocks.decrypt).toHaveBeenCalledWith("sealed-flash", "initial-password-flash");
  });

  it("returns null for expired payloads", async () => {
    state.decryptValue = JSON.stringify({
      password: "TempPassword!23",
      expiresAt: Date.now() - 1,
    });
    const { openInitialPasswordFlash } = await import("../initial-password-flash");

    await expect(openInitialPasswordFlash("sealed-flash")).resolves.toBeNull();
  });

  it("returns null for invalid or undecryptable payloads", async () => {
    const { openInitialPasswordFlash } = await import("../initial-password-flash");

    state.decryptValue = "not json";
    await expect(openInitialPasswordFlash("sealed-flash")).resolves.toBeNull();

    mocks.decrypt.mockRejectedValueOnce(new Error("bad tag"));
    await expect(openInitialPasswordFlash("sealed-flash")).resolves.toBeNull();
  });
});
