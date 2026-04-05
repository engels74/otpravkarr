// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHealthStatus: vi.fn(),
  getServerStartTime: vi.fn(() => Date.now() - 60_000),
}));

vi.mock("$lib/scheduler/jobs/health", () => ({
  getHealthStatus: mocks.getHealthStatus,
}));

vi.mock("$lib/server/uptime", () => ({
  getServerStartTime: mocks.getServerStartTime,
}));

vi.mock("../../../../package.json", () => ({
  version: "0.0.1",
}));

function healthyStatus() {
  return {
    plex: { status: "healthy", lastChecked: "2026-01-01T00:00:00.000Z" },
    dispatcharr: { reachable: true, authValid: true, lastChecked: "2026-01-01T00:00:00.000Z" },
    database: { status: "healthy", lastChecked: "2026-01-01T00:00:00.000Z" },
  };
}

function degradedStatus() {
  return {
    plex: { status: "unreachable", lastChecked: "2026-01-01T00:00:00.000Z" },
    dispatcharr: { reachable: true, authValid: true, lastChecked: "2026-01-01T00:00:00.000Z" },
    database: { status: "healthy", lastChecked: "2026-01-01T00:00:00.000Z" },
  };
}

function unhealthyStatus() {
  return {
    plex: { status: "healthy", lastChecked: "2026-01-01T00:00:00.000Z" },
    dispatcharr: { reachable: true, authValid: true, lastChecked: "2026-01-01T00:00:00.000Z" },
    database: { status: "unhealthy", lastChecked: "2026-01-01T00:00:00.000Z" },
  };
}

describe("GET /api/health", () => {
  beforeEach(() => {
    mocks.getHealthStatus.mockReset();
    mocks.getServerStartTime.mockReset();
    mocks.getServerStartTime.mockReturnValue(Date.now() - 60_000);
  });

  it("returns ok when all checks pass", async () => {
    mocks.getHealthStatus.mockReturnValue(healthyStatus());

    const { GET } = await import("./+server");
    const response = await GET({ url: new URL("http://localhost/api/health") } as Parameters<
      typeof GET
    >[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.version).toBe("0.0.1");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(body.checks.plex.status).toBe("healthy");
    expect(body.checks.dispatcharr.status).toBe("connected");
    expect(body.checks.dispatcharr.reachable).toBe(true);
    expect(body.checks.dispatcharr.authValid).toBe(true);
    expect(body.checks.database.status).toBe("healthy");
    expect(body.checks.database.lastChecked).toBe("2026-01-01T00:00:00.000Z");
  });

  it("returns degraded when plex is unreachable", async () => {
    mocks.getHealthStatus.mockReturnValue(degradedStatus());

    const { GET } = await import("./+server");
    const response = await GET({ url: new URL("http://localhost/api/health") } as Parameters<
      typeof GET
    >[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.checks.plex.status).toBe("unreachable");
  });

  it("returns unhealthy when database is unhealthy", async () => {
    mocks.getHealthStatus.mockReturnValue(unhealthyStatus());

    const { GET } = await import("./+server");
    const response = await GET({ url: new URL("http://localhost/api/health") } as Parameters<
      typeof GET
    >[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("unhealthy");
    expect(body.checks.database.status).toBe("unhealthy");
  });

  it("returns degraded when dispatcharr auth is invalid", async () => {
    const status = healthyStatus();
    status.dispatcharr.authValid = false;
    mocks.getHealthStatus.mockReturnValue(status);

    const { GET } = await import("./+server");
    const response = await GET({ url: new URL("http://localhost/api/health") } as Parameters<
      typeof GET
    >[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.checks.dispatcharr.status).toBe("disconnected");
    expect(body.checks.dispatcharr.reachable).toBe(true);
    expect(body.checks.dispatcharr.authValid).toBe(false);
  });

  it("computes uptime from server start time", async () => {
    const startTime = Date.now() - 120_000;
    mocks.getServerStartTime.mockReturnValue(startTime);
    mocks.getHealthStatus.mockReturnValue(healthyStatus());

    const { GET } = await import("./+server");
    const response = await GET({ url: new URL("http://localhost/api/health") } as Parameters<
      typeof GET
    >[0]);
    const body = await response.json();

    expect(body.uptime).toBeGreaterThanOrEqual(119);
    expect(body.uptime).toBeLessThanOrEqual(121);
  });
});
