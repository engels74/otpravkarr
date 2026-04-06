// @vitest-environment node

import { describe, expect, it } from "vitest";
import { selectActivePublicOrigin } from "$lib/server/origins";

describe("selectActivePublicOrigin", () => {
  it("uses configured non-loopback origin when present", () => {
    expect(selectActivePublicOrigin("https://public.example.com", "http://127.0.0.1:5173")).toBe(
      "https://public.example.com",
    );
  });

  it("falls back to request origin when configured origin is empty", () => {
    expect(selectActivePublicOrigin("", "http://127.0.0.1:5173")).toBe("http://127.0.0.1:5173");
  });

  it("uses request origin when configured origin is stale loopback", () => {
    expect(selectActivePublicOrigin("http://localhost:3000", "http://127.0.0.1:5173")).toBe(
      "http://127.0.0.1:5173",
    );
  });

  it("keeps configured loopback origin when it matches request service", () => {
    expect(selectActivePublicOrigin("http://localhost:3000", "http://127.0.0.1:3000")).toBe(
      "http://localhost:3000",
    );
  });
});
