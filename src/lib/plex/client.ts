import { BadRequest, MyPlexAccount, NotFound, PlexServer, Unauthorized } from "@ctrl/plex";

import type { DiscoveredServer, PlexConnectionStatus, PlexServerInfo } from "./types";
import { PlexAuthError, PlexConnectionError } from "./types";

/**
 * Validate a Plex server token by connecting and returning server metadata.
 */
export async function validateServerToken(url: string, token: string): Promise<PlexServerInfo> {
  try {
    const server = new PlexServer(url, token);
    await server.connect();

    if (!server.friendlyName || !server.machineIdentifier) {
      throw new PlexConnectionError("Server metadata missing after connect");
    }

    return {
      friendlyName: server.friendlyName,
      machineIdentifier: server.machineIdentifier,
      version: server.version,
    };
  } catch (error: unknown) {
    if (error instanceof PlexAuthError || error instanceof PlexConnectionError) {
      throw error;
    }
    if (error instanceof Unauthorized) {
      throw new PlexAuthError("Invalid or expired Plex token");
    }
    if (error instanceof BadRequest) {
      throw new PlexConnectionError("Bad request: invalid server URL or parameters");
    }
    if (error instanceof NotFound) {
      throw new PlexConnectionError("Not found: server endpoint unavailable");
    }
    throw new PlexConnectionError(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Check the health of a Plex server connection.
 */
export async function checkServerHealth(
  url: string,
  token: string,
  expectedMachineId: string,
): Promise<PlexConnectionStatus> {
  try {
    const server = new PlexServer(url, token);
    await server.connect();

    if (!server.machineIdentifier) {
      return "unreachable";
    }

    if (server.machineIdentifier !== expectedMachineId) {
      return "server_changed";
    }

    return "healthy";
  } catch (error: unknown) {
    if (error instanceof Unauthorized) {
      return "unauthorized";
    }
    if (error instanceof BadRequest || error instanceof NotFound) {
      return "unreachable";
    }
    return "unreachable";
  }
}

/**
 * Connect to a Plex account using a token.
 */
export async function getAccount(token: string): Promise<MyPlexAccount> {
  try {
    return await new MyPlexAccount({ token }).connect();
  } catch (error: unknown) {
    if (error instanceof Unauthorized) {
      throw new PlexAuthError("Invalid or expired Plex token");
    }
    if (error instanceof BadRequest) {
      throw new PlexConnectionError("Bad request: invalid account token or parameters");
    }
    if (error instanceof NotFound) {
      throw new PlexConnectionError("Not found: account endpoint unavailable");
    }
    throw new PlexConnectionError(error instanceof Error ? error.message : String(error));
  }
}

/**
 * List server resources available to the account.
 */
export async function getServerResources(
  account: MyPlexAccount,
): Promise<Array<{ name: string; machineId: string; connect: () => Promise<PlexServer> }>> {
  try {
    const resources = await account.resources();
    return resources.map((resource) => ({
      name: resource.name,
      machineId: resource.clientIdentifier,
      connect: () => resource.connect(),
    }));
  } catch (error: unknown) {
    if (error instanceof PlexAuthError || error instanceof PlexConnectionError) {
      throw error;
    }
    if (error instanceof Unauthorized) {
      throw new PlexAuthError("Invalid or expired Plex token");
    }
    if (error instanceof BadRequest) {
      throw new PlexConnectionError("Bad request: failed to list server resources");
    }
    if (error instanceof NotFound) {
      throw new PlexConnectionError("Not found: resources endpoint unavailable");
    }
    throw new PlexConnectionError(error instanceof Error ? error.message : String(error));
  }
}

/**
 * IPs that are almost never reachable from another host.
 */
const DEPRIORITIZED_IP_PREFIXES = ["127.", "172.17.", "169.254.", "::1", "fe80:"];

function isDeprioritizedAddress(address: string): boolean {
  return DEPRIORITIZED_IP_PREFIXES.some((prefix) => address.startsWith(prefix));
}

/**
 * Score a connection for ranking. Higher = better.
 * Remote HTTPS (.plex.direct) > Local HTTPS > Local HTTP.
 * Relay and deprioritized IPs get lower scores.
 */
function scoreConnection(conn: {
  uri: string;
  protocol: string;
  address: string;
  local: boolean;
  relay: boolean;
}): number {
  if (conn.relay) return 0;
  if (isDeprioritizedAddress(conn.address)) return 1;
  if (!conn.local && conn.protocol === "https") return 4; // remote HTTPS (.plex.direct)
  if (conn.local && conn.protocol === "https") return 3;
  if (conn.local && conn.protocol === "http") return 2;
  return 2;
}

/**
 * Discover Plex servers available to an account.
 * Returns servers filtered to those providing "server", with connections ranked by quality.
 */
export async function discoverServers(token: string): Promise<DiscoveredServer[]> {
  try {
    const account = await new MyPlexAccount({ token }).connect();
    const resources = await account.resources();

    return resources
      .filter((r) => r.provides.includes("server"))
      .map((r) => ({
        name: r.name,
        machineId: r.clientIdentifier,
        connections: r.connections
          .map((c) => ({
            uri: c.uri,
            protocol: c.protocol,
            address: c.address,
            port: c.port,
            local: c.local,
            relay: (c as unknown as { relay?: boolean }).relay ?? false,
          }))
          .sort((a, b) => scoreConnection(b) - scoreConnection(a)),
      }));
  } catch (error: unknown) {
    if (error instanceof PlexAuthError || error instanceof PlexConnectionError) {
      throw error;
    }
    if (error instanceof Unauthorized) {
      throw new PlexAuthError("Invalid or expired Plex token");
    }
    if (error instanceof BadRequest) {
      throw new PlexConnectionError("Bad request: failed to discover servers");
    }
    if (error instanceof NotFound) {
      throw new PlexConnectionError("Not found: discovery endpoint unavailable");
    }
    throw new PlexConnectionError(error instanceof Error ? error.message : String(error));
  }
}
