import type { MyPlexAccount } from "@ctrl/plex";
import { z } from "zod";
import type { PlexFriend } from "./types";

const PlexFriendSchema = z.object({
  id: z.number(),
  uuid: z.string().optional(),
  username: z.string().optional(),
  title: z.string().optional(),
  friendlyName: z.string().optional(),
  email: z.string(),
  thumb: z.string().optional(),
  status: z.string(),
});

const PlexFriendsResponseSchema = z.array(PlexFriendSchema);

const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

let friendsCache: { friends: PlexFriend[]; fetchedAt: number } | null = null;

export async function fetchFriends(account: MyPlexAccount): Promise<PlexFriend[]> {
  const response = await account.query({ url: "https://plex.tv/api/v2/friends", method: "get" });
  const parseResult = PlexFriendsResponseSchema.safeParse(response);

  if (!parseResult.success) {
    console.warn("Unexpected Plex friends response shape:", parseResult.error.message);
    return [];
  }

  friendsCache = { friends: parseResult.data, fetchedAt: Date.now() };
  return parseResult.data;
}

export function isCurrentFriend(plexAccountId: number, friends: PlexFriend[]): boolean {
  return friends.some((f) => f.id === plexAccountId);
}

export function getCachedFriends(ttlMs: number = DEFAULT_CACHE_TTL_MS): PlexFriend[] | null {
  if (!friendsCache) return null;
  if (Date.now() - friendsCache.fetchedAt > ttlMs) return null;
  return friendsCache.friends;
}

export function invalidateFriendsCache(): void {
  friendsCache = null;
}
