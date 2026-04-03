import { MyPlexAccount, Unauthorized } from "@ctrl/plex";
import type { PlexIdentity } from "./types";
import { PlexAuthError } from "./types";

const EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

interface PendingLogin {
  webLogin: unknown;
  createdAt: number;
}

interface CompletedLogin {
  identity: PlexIdentity;
  createdAt: number;
}

const pending = new Map<string, PendingLogin>();
const completed = new Map<string, CompletedLogin>();

function isExpired(entry: PendingLogin): boolean {
  return Date.now() - entry.createdAt > EXPIRY_MS;
}

function isCompletedExpired(entry: CompletedLogin): boolean {
  return Date.now() - entry.createdAt > EXPIRY_MS;
}

export async function initiateOAuth(forwardUrl: string): Promise<{ id: string; uri: string }> {
  // Opportunistic cleanup of expired sessions to bound memory growth
  for (const [key, entry] of pending) {
    if (isExpired(entry)) pending.delete(key);
  }
  for (const [key, entry] of completed) {
    if (isCompletedExpired(entry)) completed.delete(key);
  }

  try {
    const webLogin = await MyPlexAccount.getWebLogin(forwardUrl);

    if (!webLogin.uri) {
      throw new PlexAuthError("getWebLogin() returned an invalid response: missing uri");
    }

    const id = crypto.randomUUID();
    pending.set(id, { webLogin, createdAt: Date.now() });
    return { id, uri: webLogin.uri };
  } catch (error: unknown) {
    if (error instanceof PlexAuthError) {
      throw error;
    }
    if (error instanceof Unauthorized) {
      throw new PlexAuthError("OAuth initiation failed: unauthorized");
    }
    throw new PlexAuthError(
      `OAuth initiation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function completeOAuth(id: string, timeoutSeconds?: number): Promise<PlexIdentity> {
  const cached = completed.get(id);
  if (cached) {
    if (isCompletedExpired(cached)) {
      completed.delete(id);
    } else {
      return cached.identity;
    }
  }

  const entry = pending.get(id);
  if (!entry || isExpired(entry)) {
    pending.delete(id);
    completed.delete(id);
    throw new PlexAuthError("OAuth session not found or expired");
  }

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

    const identity = {
      id: account.id,
      uuid: account.uuid ?? "",
      username: account.username ?? "",
      email: account.email ?? "",
      thumb: account.thumb ?? "",
      authenticationToken: account.authenticationToken,
    };

    pending.delete(id);
    completed.set(id, { identity, createdAt: Date.now() });

    return identity;
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
  const cached = completed.get(id);
  if (cached && isCompletedExpired(cached)) {
    completed.delete(id);
  }

  const entry = pending.get(id);
  if (!entry) return false;
  if (isExpired(entry)) {
    pending.delete(id);
    completed.delete(id);
    return false;
  }
  return true;
}

export function removePendingOAuth(id: string): void {
  pending.delete(id);
  completed.delete(id);
}

export function cleanExpiredOAuth(): void {
  pending.forEach((entry, id) => {
    if (isExpired(entry)) {
      pending.delete(id);
    }
  });
  completed.forEach((entry, id) => {
    if (isCompletedExpired(entry)) {
      completed.delete(id);
    }
  });
}
