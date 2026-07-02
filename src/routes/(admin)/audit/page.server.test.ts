// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => ({ id: 1, username: "admin" })),
  queryAuditLog: vi.fn(),
}));

vi.mock("$lib/server/auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("$lib/db/repositories/audit", () => ({ queryAuditLog: mocks.queryAuditLog }));
vi.mock("$lib/db/types", () => ({
  AuditAction: { SETUP_COMPLETED: "setup.completed", USER_PROVISIONED: "user.provisioned" },
}));

const { load } = await import("./+page.server");

function loadEvent(search = "") {
  return {
    url: new URL(`http://localhost/audit${search}`),
  } as unknown as Parameters<typeof load>[0];
}

beforeEach(() => {
  mocks.requireAdmin.mockClear();
  mocks.queryAuditLog.mockReset();
});

describe("audit load — page clamping (ISSUE-013)", () => {
  it("clamps an out-of-range ?page=999 to the last page and re-queries at the clamped offset", async () => {
    // total 50, limit 50 → totalPages 1. The first query (offset for page 999)
    // is out of range and returns no rows; the clamped re-query (offset 0) does.
    mocks.queryAuditLog.mockImplementation((filters: { offset: number }) => {
      if (filters.offset === 0) return { entries: [{ id: 1 }], total: 50 };
      return { entries: [], total: 50 };
    });

    const result = (await load(loadEvent("?page=999"))) as {
      entries: unknown[];
      total: number;
      totalPages: number;
      filters: { page: number };
    };

    expect(result.total).toBe(50);
    expect(result.totalPages).toBe(1);
    // Clamped page returned so "Page X of totalPages" is coherent.
    expect(result.filters.page).toBe(1);
    // Re-query surfaced the last page's rows instead of the empty out-of-range slice.
    expect(result.entries).toHaveLength(1);
    expect(mocks.queryAuditLog).toHaveBeenCalledTimes(2);
  });

  it("does not clamp or re-query an in-range page", async () => {
    // total 120, limit 50 → totalPages 3; page 2 is valid.
    mocks.queryAuditLog.mockReturnValue({ entries: [{ id: 1 }], total: 120 });

    const result = (await load(loadEvent("?page=2&limit=50"))) as {
      totalPages: number;
      filters: { page: number };
    };

    expect(result.totalPages).toBe(3);
    expect(result.filters.page).toBe(2);
    expect(mocks.queryAuditLog).toHaveBeenCalledTimes(1);
  });

  it("floors a non-positive page to 1", async () => {
    mocks.queryAuditLog.mockReturnValue({ entries: [], total: 0 });

    const result = (await load(loadEvent("?page=0"))) as { filters: { page: number } };

    expect(result.filters.page).toBe(1);
  });
});
