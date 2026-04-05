import type { PlexConnectionStatus } from "$lib/plex/types";

export type HealthState = {
  plex: { status: PlexConnectionStatus; lastChecked: string | null };
  dispatcharr: { reachable: boolean; authValid: boolean; lastChecked: string | null };
  database: { status: "healthy" | "unhealthy"; lastChecked: string | null };
};

export const healthStatus = $state<HealthState>({
  plex: { status: "unreachable", lastChecked: null },
  dispatcharr: { reachable: false, authValid: false, lastChecked: null },
  database: { status: "unhealthy", lastChecked: null },
});

export function setHealthStatus(next: HealthState) {
  healthStatus.plex = next.plex;
  healthStatus.dispatcharr = next.dispatcharr;
  healthStatus.database = next.database;
}

export function resetHealthStatus() {
  healthStatus.plex = { status: "unreachable", lastChecked: null };
  healthStatus.dispatcharr = { reachable: false, authValid: false, lastChecked: null };
  healthStatus.database = { status: "unhealthy", lastChecked: null };
}
