// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminApi: vi.fn(),
  getHealthStatus: vi.fn(),
  getServerStartTime: vi.fn(() => Date.now() - 60_000),
}));

vi.mock("$lib/server/auth", () => ({
  requireAdminApi: mocks.requireAdminApi,
}));

vi.mock("$lib/scheduler/jobs/health", () => ({
  getHealthStatus: mocks.getHealthStatus,
}));

vi.mock("$lib/server/uptime", () => ({
  getServerStartTime: mocks.getServerStartTime,
}));

vi.mock("../../../../../package.json", () => ({
  version: "0.0.1",
}));

function healthyStatus() {
  return {
    plex: { status: "healthy", lastChecked: "2026-01-01T00:00:00.000Z" },
    dispatcharr: { reachable: true, authValid: true, lastChecked: "2026-01-01T00:00:00.000Z" },
    database: { status: "healthy", lastChecked: "2026-01-01T00:00:00.000Z" },
  };
}

function createEvent() {
  return { url: new URL("http://localhost/api/internal/health") } as Parameters<
    typeof import("./+server").GET
  >[0];
}

describe("GET /api/internal/health", () => {
  beforeEach(() => {
    mocks.requireAdminApi.mockReset();
    mocks.getHealthStatus.mockReset();
    mocks.getServerStartTime.mockReset();
    mocks.getServerStartTime.mockReturnValue(Date.now() - 60_000);
  });

  it("rejects unauthenticated requests", async () => {
    mocks.requireAdminApi.mockRejectedValueOnce(
      Object.assign(new Error("Unauthorized"), { status: 401 }),
    );

    const { GET } = await import("./+server");

    await expect(GET(createEvent())).rejects.toMatchObject({ status: 401 });
  });

  it("returns full payload for authenticated admin", async () => {
    mocks.requireAdminApi.mockResolvedValueOnce({ id: 1, username: "admin" });
    mocks.getHealthStatus.mockReturnValue(healthyStatus());

    const { GET } = await import("./+server");
    const response = await GET(createEvent());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.version).toBe("0.0.1");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(body.checks.plex.status).toBe("healthy");
    expect(body.checks.plex.lastChecked).toBe("2026-01-01T00:00:00.000Z");
    expect(body.checks.dispatcharr.status).toBe("connected");
    expect(body.checks.dispatcharr.reachable).toBe(true);
    expect(body.checks.dispatcharr.authValid).toBe(true);
    expect(body.checks.database.status).toBe("healthy");
  });

  it("exposes authValid=false when Dispatcharr auth is invalid", async () => {
    mocks.requireAdminApi.mockResolvedValueOnce({ id: 1, username: "admin" });
    const status = healthyStatus();
    status.dispatcharr.authValid = false;
    mocks.getHealthStatus.mockReturnValue(status);

    const { GET } = await import("./+server");
    const response = await GET(createEvent());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.checks.dispatcharr.status).toBe("disconnected");
    expect(body.checks.dispatcharr.authValid).toBe(false);
  });

  it("computes uptime from server start time", async () => {
    mocks.requireAdminApi.mockResolvedValueOnce({ id: 1, username: "admin" });
    mocks.getServerStartTime.mockReturnValue(Date.now() - 120_000);
    mocks.getHealthStatus.mockReturnValue(healthyStatus());

    const { GET } = await import("./+server");
    const response = await GET(createEvent());
    const body = await response.json();

    expect(body.uptime).toBeGreaterThanOrEqual(119);
    expect(body.uptime).toBeLessThanOrEqual(121);
  });
});
