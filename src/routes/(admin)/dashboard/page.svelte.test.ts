import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "./+page.svelte";

const mocks = vi.hoisted(() => ({
  invalidateAll: vi.fn(async () => undefined),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock("$app/navigation", () => ({
  invalidateAll: mocks.invalidateAll,
}));

vi.mock("svelte-sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    warning: mocks.toastWarning,
  },
}));

const data = {
  userStats: {
    total: 0,
    active: 0,
    inactive: 0,
    orphaned: 0,
    byMode: { automatic: 0, self_managed: 0, staff: 0 },
  },
  health: {
    plex: { status: "healthy" as const, lastChecked: "2025-01-01T00:00:00.000Z" },
    dispatcharr: {
      reachable: true,
      authValid: true,
      lastChecked: "2025-01-01T00:00:00.000Z",
    },
    database: { status: "healthy" as const, lastChecked: "2025-01-01T00:00:00.000Z" },
  },
  syncJob: { running: false, lastRunAt: null, lastDurationMs: null },
  healthJob: { running: false, lastRunAt: null, lastDurationMs: null },
  recentAudit: [],
  availableFriends: null,
};

describe("admin dashboard page", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("bounds the Available Plex Friends list with an internal scroll container (ISSUE-001)", () => {
    const friends = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      username: `friend${i + 1}`,
      email: `friend${i + 1}@example.com`,
      status: "accepted",
    }));

    render(DashboardPage, { props: { data: { ...data, availableFriends: friends } } });

    // Every friend still renders (no truncation of the data)...
    expect(screen.getByText("friend1")).toBeTruthy();
    expect(screen.getByText("friend25")).toBeTruthy();

    // ...but inside a height-bounded, vertically scrollable list so a long friends
    // list can't grow the card unbounded.
    const list = screen.getByText("friend25").closest("ul");
    expect(list).not.toBeNull();
    expect(list?.className).toContain("overflow-y-auto");
    expect(list?.className).toMatch(/max-h-/);
  });

  it("shows Running in the sync status card while manual sync is pending", async () => {
    const pendingSync = new Promise<Response>(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => pendingSync),
    );

    render(DashboardPage, { props: { data } });
    await fireEvent.click(screen.getByRole("button", { name: "Run sync now" }));

    await waitFor(() => {
      expect(screen.getByText("Running")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Syncing…" })).toHaveProperty("disabled", true);
    });
  });
});
