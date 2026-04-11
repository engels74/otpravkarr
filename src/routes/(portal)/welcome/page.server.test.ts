// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserMapping } from "$lib/db/types";

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(async (_key: string) => "admin-plex-token" as string | null),
  getAccount: vi.fn(async (_token: string) => ({
    id: 99999,
    uuid: "admin-uuid",
    username: "admin",
    email: "admin@example.com",
    thumb: "",
    authenticationToken: "admin-token",
  })),
}));

vi.mock("$lib/db/repositories/config", () => ({
  getConfig: mocks.getConfig,
}));

vi.mock("$lib/plex/client", () => ({
  getAccount: mocks.getAccount,
}));

const ownerMapping: UserMapping = {
  id: 5,
  plex_account_id: 99999,
  plex_uuid: "admin-uuid",
  plex_username: "admin",
  plex_email: "admin@example.com",
  plex_thumb: null,
  dispatcharr_user_id: 50,
  dispatcharr_username: "admin",
  dispatcharr_xc_password_enc: "enc-pw",
  dispatcharr_group_ids: "[1]",
  dispatcharr_profile_id: 2,
  provisioning_mode: "automatic",
  is_active: 1,
  created_at: "2024-01-01 00:00:00",
  updated_at: "2024-01-01 00:00:00",
  last_synced_at: null,
  last_accessed_at: null,
};

const regularUserMapping: UserMapping = {
  id: 1,
  plex_account_id: 12345,
  plex_uuid: "user-uuid",
  plex_username: "regularuser",
  plex_email: "user@example.com",
  plex_thumb: null,
  dispatcharr_user_id: 10,
  dispatcharr_username: "regularuser",
  dispatcharr_xc_password_enc: "enc-pw",
  dispatcharr_group_ids: "[1]",
  dispatcharr_profile_id: 2,
  provisioning_mode: "automatic",
  is_active: 1,
  created_at: "2024-01-01 00:00:00",
  updated_at: "2024-01-01 00:00:00",
  last_synced_at: null,
  last_accessed_at: null,
};

function createEvent(user: UserMapping | null) {
  return { locals: { user } } as unknown as Parameters<typeof import("./+page.server").load>[0];
}

describe("welcome page load", () => {
  beforeEach(() => {
    mocks.getConfig.mockReset();
    mocks.getConfig.mockResolvedValue("admin-plex-token");
    mocks.getAccount.mockReset();
    mocks.getAccount.mockResolvedValue({
      id: 99999,
      uuid: "admin-uuid",
      username: "admin",
      email: "admin@example.com",
      thumb: "",
      authenticationToken: "admin-token",
    });
  });

  it("returns plexUsername for server owner", async () => {
    const { load } = await import("./+page.server");
    const result = await load(createEvent(ownerMapping));
    expect(result).toEqual({ plexUsername: "admin" });
  });

  it("redirects unauthenticated visitors to /", async () => {
    const { load } = await import("./+page.server");
    await expect(load(createEvent(null))).rejects.toMatchObject({
      status: 303,
      location: "/",
    });
  });

  it("redirects revoked (is_active=0) users to /", async () => {
    const { load } = await import("./+page.server");
    await expect(load(createEvent({ ...ownerMapping, is_active: 0 }))).rejects.toMatchObject({
      status: 303,
      location: "/",
    });
  });

  it("redirects non-owner users to /", async () => {
    const { load } = await import("./+page.server");
    await expect(load(createEvent(regularUserMapping))).rejects.toMatchObject({
      status: 303,
      location: "/",
    });
  });

  it("redirects to / when plex_admin_token is missing", async () => {
    mocks.getConfig.mockResolvedValue(null);
    const { load } = await import("./+page.server");
    await expect(load(createEvent(ownerMapping))).rejects.toMatchObject({
      status: 303,
      location: "/",
    });
  });
});
