import type { DispatcharrClient } from "../client";
import { HealthProbeSchema } from "../schemas";
import type { DispatcharrResult } from "../types";

export interface HealthStatus {
  reachable: boolean;
  authValid: boolean;
}

export function createHealthEndpoints(client: DispatcharrClient) {
  return {
    async checkHealth(): Promise<DispatcharrResult<HealthStatus>> {
      const result = await client.request("GET", "/api/accounts/users/?page=1&page_size=1", {
        schema: HealthProbeSchema,
      });

      if (result.ok) {
        return { ok: true, data: { reachable: true, authValid: true } };
      }

      if (result.error === "auth_failure") {
        return { ok: true, data: { reachable: true, authValid: false } };
      }

      // unexpected_shape / not_found / validation_error / server_error → server responded
      if (
        result.error === "unexpected_shape" ||
        result.error === "not_found" ||
        result.error === "validation_error" ||
        result.error === "server_error"
      ) {
        return { ok: true, data: { reachable: true, authValid: false } };
      }

      // network_error → truly unreachable (connection refused, DNS failure, timeout)
      return { ok: true, data: { reachable: false, authValid: false } };
    },
  };
}
