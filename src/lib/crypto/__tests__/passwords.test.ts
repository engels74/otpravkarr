// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock Bun.password for Vitest (Node environment)
// ---------------------------------------------------------------------------

const hashes = new Map<string, string>();
let hashCounter = 0;

vi.stubGlobal("Bun", {
  password: {
    hash: vi.fn(async (password: string, opts?: { algorithm?: string }) => {
      const id = ++hashCounter;
      const algo = opts?.algorithm ?? "argon2id";
      const hash = `$${algo}$salt${id}$${Buffer.from(password).toString("base64")}`;
      hashes.set(hash, password);
      return hash;
    }),
    verify: vi.fn(async (password: string, hash: string) => {
      // Extract the original password from our synthetic hash
      const parts = hash.split("$");
      const encoded = parts[parts.length - 1]!;
      const original = Buffer.from(encoded, "base64").toString("utf-8");
      return password === original;
    }),
  },
});

const { generateXcPassword, hashAdminPassword, verifyAdminPassword } = await import("../passwords");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("hashAdminPassword / verifyAdminPassword", () => {
  it("round-trips: hash then verify succeeds", async () => {
    const password = "correct-horse-battery-staple";
    const hash = await hashAdminPassword(password);

    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);

    const valid = await verifyAdminPassword(password, hash);
    expect(valid).toBe(true);
  });

  it("rejects wrong password", async () => {
    const hash = await hashAdminPassword("real-password");
    const valid = await verifyAdminPassword("wrong-password", hash);
    expect(valid).toBe(false);
  });

  it("produces argon2id hashes", async () => {
    const hash = await hashAdminPassword("test");
    expect(hash).toContain("$argon2id$");
  });

  it("produces different hashes for the same password (unique salts)", async () => {
    const password = "same-password";
    const hash1 = await hashAdminPassword(password);
    const hash2 = await hashAdminPassword(password);
    expect(hash1).not.toBe(hash2);
  });
});

describe("generateXcPassword", () => {
  it("returns default length of 24", () => {
    const pw = generateXcPassword();
    expect(pw.length).toBe(24);
  });

  it("respects custom length", () => {
    expect(generateXcPassword(8).length).toBe(8);
    expect(generateXcPassword(64).length).toBe(64);
    expect(generateXcPassword(1).length).toBe(1);
  });

  it("contains only alphanumeric characters", () => {
    const pw = generateXcPassword(200);
    expect(pw).toMatch(/^[A-Za-z0-9]+$/);
  });

  it("produces different passwords each call", () => {
    const passwords = new Set(Array.from({ length: 20 }, () => generateXcPassword()));
    expect(passwords.size).toBe(20);
  });

  it("uses the full charset (letters and digits present)", () => {
    // Generate a long password to make statistical absence extremely unlikely
    const pw = generateXcPassword(500);
    expect(pw).toMatch(/[A-Z]/);
    expect(pw).toMatch(/[a-z]/);
    expect(pw).toMatch(/[0-9]/);
  });
});
