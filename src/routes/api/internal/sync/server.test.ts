// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminApi: vi.fn(),
  getConfig: vi.fn((_key: string): Promise<string | null> => Promise.resolve(null)),
  appendAuditLog: vi.fn(),
  reconcileSync: vi.fn(),
}));

vi.mock("$lib/server/auth", () => ({
  requireAdminApi: mocks.requireAdminApi,
}));

vi.mock("$lib/db/repositories/config", () => ({
  getConfig: mocks.getConfig,
}));

vi.mock("$lib/db/repositories/audit", () => ({
  appendAuditLog: mocks.appendAuditLog,
}));

vi.mock("$lib/db/types", () => ({
  AuditAction: {
    SYNC_COMPLETED: "sync.completed",
    SYNC_FAILED: "sync.failed",
  },
}));

vi.mock("$lib/dispatcharr/client", () => ({
  DispatcharrClient: class {
    baseUrl: string;
    apiKey: string;
    constructor(baseUrl: string, apiKey: string) {
      this.baseUrl = baseUrl;
      this.apiKey = apiKey;
    }
  },
}));

vi.mock("$lib/bridge/lifecycle", () => ({
  reconcileSync: mocks.reconcileSync,
}));

function createEvent() {
  return {} as Parameters<typeof import("./+server").POST>[0];
}

function resetAll() {
  mocks.requireAdminApi.mockClear();
  mocks.getConfig.mockClear();
  mocks.appendAuditLog.mockClear();
  mocks.reconcileSync.mockClear();
}

describe("POST /api/internal/sync", () => {
  beforeEach(() => {
    resetAll();
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.requireAdminApi.mockRejectedValueOnce(
      Object.assign(new Error("Unauthorized"), { status: 401 }),
    );

    const { POST } = await import("./+server");

    await expect(POST(createEvent())).rejects.toMatchObject({ status: 401 });
  });

  it("returns 503 when config is missing", async () => {
    mocks.requireAdminApi.mockResolvedValueOnce({ id: 1, username: "admin" });
    mocks.getConfig.mockResolvedValue(null);

    const { POST } = await import("./+server");
    const response = await POST(createEvent());

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({
      ok: false,
      error: "missing_config",
      missing: ["dispatcharr_url", "dispatcharr_api_key", "plex_admin_token"],
    });
  });

  it("returns 503 with partial missing config", async () => {
    mocks.requireAdminApi.mockResolvedValueOnce({ id: 1, username: "admin" });
    mocks.getConfig.mockImplementation((key: string) => {
      if (key === "dispatcharr_url") return Promise.resolve("http://dispatcharr:8000");
      return Promise.resolve(null);
    });

    const { POST } = await import("./+server");
    const response = await POST(createEvent());

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.missing).toEqual(["dispatcharr_api_key", "plex_admin_token"]);
  });

  it("returns 200 with report on successful sync", async () => {
    mocks.requireAdminApi.mockResolvedValueOnce({ id: 1, username: "admin" });
    mocks.getConfig.mockImplementation((key: string) => {
      const config: Record<string, string> = {
        dispatcharr_url: "http://dispatcharr:8000",
        dispatcharr_api_key: "test-key",
        plex_admin_token: "plex-token",
      };
      return Promise.resolve(config[key] ?? null);
    });

    const report = { newFriends: 2, disabled: 0, orphaned: 0, refreshed: 1, errors: [] };
    mocks.reconcileSync.mockResolvedValueOnce(report);

    const { POST } = await import("./+server");
    const response = await POST(createEvent());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true, report });
  });

  it("appends SYNC_COMPLETED audit log on success", async () => {
    mocks.requireAdminApi.mockResolvedValueOnce({ id: 1, username: "admin" });
    mocks.getConfig.mockImplementation((key: string) => {
      const config: Record<string, string> = {
        dispatcharr_url: "http://dispatcharr:8000",
        dispatcharr_api_key: "test-key",
        plex_admin_token: "plex-token",
      };
      return Promise.resolve(config[key] ?? null);
    });

    const report = { newFriends: 0, disabled: 0, orphaned: 0, refreshed: 0, errors: [] };
    mocks.reconcileSync.mockResolvedValueOnce(report);

    const { POST } = await import("./+server");
    await POST(createEvent());

    expect(mocks.appendAuditLog).toHaveBeenCalledWith({
      action: "sync.completed",
      detail: { report },
    });
  });

  it("returns 500 when sync throws", async () => {
    mocks.requireAdminApi.mockResolvedValueOnce({ id: 1, username: "admin" });
    mocks.getConfig.mockImplementation((key: string) => {
      const config: Record<string, string> = {
        dispatcharr_url: "http://dispatcharr:8000",
        dispatcharr_api_key: "test-key",
        plex_admin_token: "plex-token",
      };
      return Promise.resolve(config[key] ?? null);
    });

    mocks.reconcileSync.mockRejectedValueOnce(new Error("Plex API timeout"));

    const { POST } = await import("./+server");
    const response = await POST(createEvent());

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      ok: false,
      error: "sync_failed",
      message: "Plex API timeout",
    });
  });

  it("appends SYNC_FAILED audit log on error", async () => {
    mocks.requireAdminApi.mockResolvedValueOnce({ id: 1, username: "admin" });
    mocks.getConfig.mockImplementation((key: string) => {
      const config: Record<string, string> = {
        dispatcharr_url: "http://dispatcharr:8000",
        dispatcharr_api_key: "test-key",
        plex_admin_token: "plex-token",
      };
      return Promise.resolve(config[key] ?? null);
    });

    mocks.reconcileSync.mockRejectedValueOnce(new Error("Connection refused"));

    const { POST } = await import("./+server");
    await POST(createEvent());

    expect(mocks.appendAuditLog).toHaveBeenCalledWith({
      action: "sync.failed",
      detail: { error: "Connection refused" },
    });
  });
});
