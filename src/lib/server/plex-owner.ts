import { getConfig } from "$lib/db/repositories/config";
import type { UserMapping } from "$lib/db/types";
import { getAccount } from "$lib/plex/client";

let cachedOwner: { token: string; accountId: number } | null = null;

export function getPlexOwnerAccountIdFromAccount(account: { id?: unknown }): number | null {
  return typeof account.id === "number" ? account.id : null;
}

export function rememberPlexOwnerAccountId(token: string, accountId: number): void {
  cachedOwner = { token, accountId };
}

export async function resolvePlexOwnerAccountId(
  token: string | null | undefined,
): Promise<number | null> {
  if (!token) return null;
  if (cachedOwner?.token === token) return cachedOwner.accountId;

  const account = await getAccount(token);
  const accountId = getPlexOwnerAccountIdFromAccount(account);
  if (accountId != null) {
    rememberPlexOwnerAccountId(token, accountId);
  }
  return accountId;
}

export async function tryResolveConfiguredPlexOwnerAccountId(): Promise<number | null> {
  try {
    const token = await getConfig("plex_admin_token");
    return await resolvePlexOwnerAccountId(token);
  } catch {
    return null;
  }
}

export function isPlexOwnerMapping(
  mapping: Pick<UserMapping, "plex_account_id">,
  ownerPlexAccountId: number | null,
): boolean {
  return ownerPlexAccountId != null && mapping.plex_account_id === ownerPlexAccountId;
}

export function excludePlexOwnerMappings<T extends Pick<UserMapping, "plex_account_id">>(
  mappings: T[],
  ownerPlexAccountId: number | null,
): T[] {
  if (ownerPlexAccountId == null) return mappings;
  return mappings.filter((mapping) => !isPlexOwnerMapping(mapping, ownerPlexAccountId));
}
