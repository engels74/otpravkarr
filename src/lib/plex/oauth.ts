import { MyPlexAccount, Unauthorized } from "@ctrl/plex";
import type { PlexIdentity } from "./types";
import { PlexAuthError } from "./types";

const EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

interface PendingLogin {
  webLogin: unknown;
  createdAt: number;
}

const pending = new Map<string, PendingLogin>();

function isExpired(entry: PendingLogin): boolean {
  return Date.now() - entry.createdAt > EXPIRY_MS;
}

export async function initiateOAuth(forwardUrl: string): Promise<{ id: string; uri: string }> {
  // Opportunistic cleanup of expired sessions to bound memory growth
  for (const [key, entry] of pending) {
    if (isExpired(entry)) pending.delete(key);
  }

  const webLogin = await MyPlexAccount.getWebLogin(forwardUrl);

  if (!webLogin.uri) {
    throw new PlexAuthError("getWebLogin() returned an invalid response: missing uri");
  }

  const id = crypto.randomUUID();
  pending.set(id, { webLogin, createdAt: Date.now() });
  return { id, uri: webLogin.uri };
}

export async function completeOAuth(id: string, timeoutSeconds?: number): Promise<PlexIdentity> {
  const entry = pending.get(id);
  if (!entry || isExpired(entry)) {
    pending.delete(id);
    throw new PlexAuthError("OAuth session not found or expired");
  }

  // Remove immediately so concurrent calls cannot reuse the same session
  pending.delete(id);

  try {
    const account = await MyPlexAccount.webLoginCheck(
      entry.webLogin as Parameters<typeof MyPlexAccount.webLoginCheck>[0],
      { timeoutSeconds: timeoutSeconds ?? 120 },
    );

    if (typeof account.authenticationToken !== "string" || !account.authenticationToken) {
      throw new PlexAuthError("OAuth completed but authenticationToken is missing");
    }
    if (typeof account.id !== "number" || account.id <= 0) {
      throw new PlexAuthError("OAuth completed but account id is missing or invalid");
    }

    return {
      id: account.id,
      uuid: account.uuid ?? "",
      username: account.username ?? "",
      email: account.email ?? "",
      thumb: account.thumb ?? "",
      authenticationToken: account.authenticationToken,
    };
  } catch (error: unknown) {
    if (error instanceof PlexAuthError) {
      throw error;
    }
    if (error instanceof Unauthorized) {
      throw new PlexAuthError("OAuth login check failed: unauthorized");
    }
    throw new PlexAuthError(
      `OAuth login check failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function getPendingOAuth(id: string): boolean {
  const entry = pending.get(id);
  if (!entry) return false;
  if (isExpired(entry)) {
    pending.delete(id);
    return false;
  }
  return true;
}

export function removePendingOAuth(id: string): void {
  pending.delete(id);
}

export function cleanExpiredOAuth(): void {
  pending.forEach((entry, id) => {
    if (isExpired(entry)) {
      pending.delete(id);
    }
  });
}
