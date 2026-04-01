import { describe, expect, it } from "vitest";
import { generateXcPassword, hashAdminPassword, verifyAdminPassword } from "../passwords";

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
