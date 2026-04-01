import { MyPlexAccount, PlexServer, Unauthorized } from "@ctrl/plex";

import type { PlexConnectionStatus, PlexServerInfo } from "./types";
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

    if (server.machineIdentifier !== expectedMachineId) {
      return "server_changed";
    }

    return "healthy";
  } catch (error: unknown) {
    if (error instanceof Unauthorized) {
      return "unauthorized";
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
    throw new PlexConnectionError(error instanceof Error ? error.message : String(error));
  }
}
