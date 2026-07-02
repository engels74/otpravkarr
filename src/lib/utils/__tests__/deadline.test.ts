// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { withDeadline } from "$lib/utils/deadline";

afterEach(() => {
  vi.useRealTimers();
});

describe("withDeadline", () => {
  it("resolves to the work value when it settles before the deadline", async () => {
    const result = await withDeadline(Promise.resolve("ok"), 1_000, "fallback");
    expect(result).toBe("ok");
  });

  it("resolves to the fallback when the work rejects", async () => {
    const result = await withDeadline(Promise.reject(new Error("boom")), 1_000, "fallback");
    expect(result).toBe("fallback");
  });

  it("resolves to the fallback when the deadline fires before the work", async () => {
    vi.useFakeTimers();
    // Work that never settles on its own.
    const never = new Promise<string>(() => {});
    const raced = withDeadline(never, 8_000, "degraded");

    await vi.advanceTimersByTimeAsync(8_000);

    await expect(raced).resolves.toBe("degraded");
  });

  it("does not let a slow-but-eventual work overwrite the fallback after the deadline", async () => {
    vi.useFakeTimers();
    let resolveWork: (v: string) => void = () => {};
    const slow = new Promise<string>((r) => {
      resolveWork = r;
    });
    const raced = withDeadline(slow, 5_000, "degraded");

    await vi.advanceTimersByTimeAsync(5_000);
    // Work finishes late — the already-resolved race must stay "degraded".
    resolveWork("late");
    await expect(raced).resolves.toBe("degraded");
  });
});
