import { getHealthStatus } from "$lib/scheduler/jobs/health";
import { getServerStartTime } from "$lib/server/uptime";
import { version } from "../../../../package.json";
import type { RequestHandler } from "./$types";

function deriveStatus(health: ReturnType<typeof getHealthStatus>): "ok" | "degraded" | "unhealthy" {
  if (health.database.status === "unhealthy") {
    return "unhealthy";
  }

  if (
    health.plex.status === "healthy" &&
    health.dispatcharr.reachable &&
    health.dispatcharr.authValid &&
    health.database.status === "healthy"
  ) {
    return "ok";
  }

  return "degraded";
}

export const GET: RequestHandler = async () => {
  const health = getHealthStatus();
  const status = deriveStatus(health);
  const uptime = Math.floor((Date.now() - getServerStartTime()) / 1000);

  return Response.json({
    status,
    checks: {
      plex: {
        status: health.plex.status,
        lastChecked: health.plex.lastChecked,
      },
      dispatcharr: {
        status:
          health.dispatcharr.reachable && health.dispatcharr.authValid
            ? "connected"
            : "disconnected",
        reachable: health.dispatcharr.reachable,
        authValid: health.dispatcharr.authValid,
        lastChecked: health.dispatcharr.lastChecked,
      },
      database: {
        status: health.database.status,
        lastChecked: health.database.lastChecked,
      },
    },
    uptime,
    version,
  });
};
