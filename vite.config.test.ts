// @vitest-environment node

import { describe, expect, it } from "vitest";
import { resolveDevPort } from "./vite.config";

describe("resolveDevPort", () => {
  it("uses 3000 when PORT is missing", () => {
    expect(resolveDevPort(undefined)).toBe(3000);
  });

  it("uses 3000 when PORT is empty or invalid", () => {
    expect(resolveDevPort("")).toBe(3000);
    expect(resolveDevPort("  ")).toBe(3000);
    expect(resolveDevPort("abc")).toBe(3000);
    expect(resolveDevPort("-1")).toBe(3000);
    expect(resolveDevPort("0")).toBe(3000);
  });

  it("uses the configured numeric PORT", () => {
    expect(resolveDevPort("4173")).toBe(4173);
    expect(resolveDevPort(" 3000 ")).toBe(3000);
  });
});
