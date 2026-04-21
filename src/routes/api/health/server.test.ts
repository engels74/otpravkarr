// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHealthStatus: vi.fn(),
}));

vi.mock("$lib/scheduler/jobs/health", () => ({
  getHealthStatus: mocks.getHealthStatus,
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
  });

  it("returns only { status } with status ok when all checks pass", async () => {
    mocks.getHealthStatus.mockReturnValue(healthyStatus());

    const { GET } = await import("./+server");
    const response = await GET({ url: new URL("http://localhost/api/health") } as Parameters<
      typeof GET
    >[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok" });
  });

  it("returns degraded when plex is unreachable", async () => {
    mocks.getHealthStatus.mockReturnValue(degradedStatus());

    const { GET } = await import("./+server");
    const response = await GET({ url: new URL("http://localhost/api/health") } as Parameters<
      typeof GET
    >[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "degraded" });
  });

  it("returns unhealthy when database is unhealthy", async () => {
    mocks.getHealthStatus.mockReturnValue(unhealthyStatus());

    const { GET } = await import("./+server");
    const response = await GET({ url: new URL("http://localhost/api/health") } as Parameters<
      typeof GET
    >[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "unhealthy" });
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
    expect(body).toEqual({ status: "degraded" });
  });

  it("does not expose version, uptime, or component details", async () => {
    mocks.getHealthStatus.mockReturnValue(healthyStatus());

    const { GET } = await import("./+server");
    const response = await GET({ url: new URL("http://localhost/api/health") } as Parameters<
      typeof GET
    >[0]);
    const body = await response.json();

    expect(body).not.toHaveProperty("version");
    expect(body).not.toHaveProperty("uptime");
    expect(body).not.toHaveProperty("checks");
    expect(Object.keys(body)).toEqual(["status"]);
  });
});
