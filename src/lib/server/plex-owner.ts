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

// Like excludePlexOwnerMappings, but keeps the owner's *deliberate* subscriber
// (is_owner = 1, created via "subscribe owner") while still hiding the owner's
// implicit superuser/auto mapping. Both share the owner's Plex account id, so a
// pure account-id filter would also hide the intentional subscriber. Use this
// only for admin-UI surfaces (user list, drift checks, dashboard stats) where
// the owner-subscriber should be manageable — NOT for friend-sync reaping, which
// must drop every owner-account mapping (see excludePlexOwnerMappings /
// lifecycle.reconcileSync) or it would disable the owner's subscriber each sync.
export function excludePlexOwnerNonSubscriberMappings<
  T extends Pick<UserMapping, "plex_account_id" | "is_owner">,
>(mappings: T[], ownerPlexAccountId: number | null): T[] {
  if (ownerPlexAccountId == null) return mappings;
  return mappings.filter(
    (mapping) => mapping.plex_account_id !== ownerPlexAccountId || mapping.is_owner === 1,
  );
}
