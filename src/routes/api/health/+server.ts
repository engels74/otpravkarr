import { getHealthStatus } from "$lib/scheduler/jobs/health";
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
  const status = deriveStatus(getHealthStatus());
  return Response.json({ status });
};
