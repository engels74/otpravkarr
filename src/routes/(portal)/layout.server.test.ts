// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { UserMapping } from "$lib/db/types";

function createUser(overrides?: Partial<UserMapping>): UserMapping {
  return {
    id: 1,
    plex_account_id: 12345,
    plex_uuid: "abc-uuid",
    plex_username: "testuser",
    plex_email: "test@example.com",
    plex_thumb: "https://plex.tv/users/abc/avatar",
    dispatcharr_user_id: 10,
    dispatcharr_username: "testuser",
    dispatcharr_xc_password_enc: "enc-password",
    dispatcharr_group_ids: "[]",
    dispatcharr_profile_id: null,
    provisioning_mode: "automatic",
    is_active: 1,
    created_at: "2024-01-01 00:00:00",
    updated_at: "2024-01-01 00:00:00",
    last_synced_at: null,
    last_accessed_at: null,
    ...overrides,
  };
}

describe("portal layout server load", () => {
  it("returns null user when not authenticated", async () => {
    const { load } = await import("./+layout.server");

    const result = await load({
      locals: { user: undefined },
    } as unknown as Parameters<typeof load>[0]);

    expect(result).toEqual({ user: null });
  });

  it("returns user data when authenticated", async () => {
    const { load } = await import("./+layout.server");
    const user = createUser();

    const result = await load({
      locals: { user },
    } as unknown as Parameters<typeof load>[0]);

    expect(result).toEqual({
      user: {
        plexUsername: "testuser",
        plexThumb: "https://plex.tv/users/abc/avatar",
        provisioningMode: "automatic",
      },
    });
  });

  it("returns correct provisioning mode for self-managed user", async () => {
    const { load } = await import("./+layout.server");
    const user = createUser({ provisioning_mode: "self_managed" });

    const result = await load({
      locals: { user },
    } as unknown as Parameters<typeof load>[0]);

    expect(result).toEqual({
      user: {
        plexUsername: "testuser",
        plexThumb: "https://plex.tv/users/abc/avatar",
        provisioningMode: "self_managed",
      },
    });
  });
});
