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

  it("uses configured origin when configured origin is stale loopback (avoids Host header influence)", () => {
    expect(selectActivePublicOrigin("http://localhost:3000", "http://127.0.0.1:5173")).toBe(
      "http://localhost:3000",
    );
  });

  it("preserves the active 127.0.0.1 loopback hostname when it matches the configured service", () => {
    expect(selectActivePublicOrigin("http://localhost:3000", "http://127.0.0.1:3000")).toBe(
      "http://127.0.0.1:3000",
    );
  });

  it("preserves the active localhost loopback hostname when it matches the configured service", () => {
    expect(selectActivePublicOrigin("http://127.0.0.1:3000", "http://localhost:3000")).toBe(
      "http://localhost:3000",
    );
  });

  it("does not treat hostnames that only start with 127 as loopback", () => {
    expect(selectActivePublicOrigin("http://localhost:3000", "http://127.evil.com:3000")).toBe(
      "http://localhost:3000",
    );
  });
});
