// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserMapping } from "$lib/db/types";
import type { DispatcharrChannel, DispatcharrResult } from "$lib/dispatcharr/types";

const state = vi.hoisted(() => ({
  limiterAllowed: true,
  configValues: {} as Record<string, string | null>,
  user: null as UserMapping | null,
  initialPasswordCookie: undefined as string | undefined,
}));

const mocks = vi.hoisted(() => ({
  oauthLimiterCheck: vi.fn((_address: string) => ({ allowed: state.limiterAllowed })),
  initiateOAuth: vi.fn(async (_forwardUrl: string) => ({
    id: "oauth-pin-id",
    uri: "https://app.plex.tv/auth#?clientID=xxx&code=yyy",
  })),
  decrypt: vi.fn(async (_enc: string, _purpose: string) => "decrypted-password"),
  getConfig: vi.fn(async (key: string) => state.configValues[key] ?? null),
  updateLastAccessed: vi.fn((_id: number) => {}),
  rotateCredentials: vi.fn(async () => {}),
  buildXcUrl: vi.fn(
    (_params: unknown) => "http://host/get.php?username=u&password=p&type=m3u_plus",
  ),
  buildPlayerApiUrl: vi.fn(
    (_params: unknown) => "http://host/player_api.php?username=u&password=p",
  ),
  generateQRCodeDataUri: vi.fn(async (_url: string) => "data:image/png;base64,qrcode"),
  getSupportedPlatforms: vi.fn(() => [
    { id: "generic", name: "Generic", description: "Standard M3U playlist URL" },
  ]),
  buildPlatformUrl: vi.fn((_id: string, _params: unknown) => ({
    type: "url",
    url: "http://host/get.php?username=u&password=p&type=m3u_plus",
  })),
  DispatcharrClient: vi.fn(),
  createChannelEndpoints: vi.fn(() => ({
    getAllChannels: vi.fn(
      async (): Promise<DispatcharrResult<DispatcharrChannel[]>> => ({
        ok: true as const,
        data: [
          { id: 1, name: "Channel 1", channel_number: 1 },
          { id: 2, name: "Channel 2", channel_number: 2 },
        ],
      }),
    ),
  })),
  generateM3U: vi.fn(
    (_params: unknown) => "#EXTM3U\n#EXTINF:-1,Channel 1\nhttp://host/live/u/p/1.ts\n",
  ),
}));

vi.mock("$lib/server/ratelimit", () => ({
  oauthLimiter: { check: mocks.oauthLimiterCheck },
}));

vi.mock("$lib/plex/oauth", () => ({
  initiateOAuth: mocks.initiateOAuth,
}));

vi.mock("$lib/plex/types", async () => {
  class PlexAuthError extends Error {
    override readonly name = "PlexAuthError" as const;
  }
  return { PlexAuthError };
});

vi.mock("$lib/crypto/encryption", () => ({
  decrypt: mocks.decrypt,
}));

vi.mock("$lib/db/repositories/config", () => ({
  getConfig: mocks.getConfig,
}));

vi.mock("$lib/db/repositories/users", () => ({
  updateLastAccessed: mocks.updateLastAccessed,
}));

vi.mock("$lib/bridge/lifecycle", () => ({
  rotateCredentials: mocks.rotateCredentials,
}));

vi.mock("$lib/url/xc", () => ({
  buildXcUrl: mocks.buildXcUrl,
  buildPlayerApiUrl: mocks.buildPlayerApiUrl,
}));

vi.mock("$lib/url/platforms", () => ({
  getSupportedPlatforms: mocks.getSupportedPlatforms,
  buildPlatformUrl: mocks.buildPlatformUrl,
}));

vi.mock("$lib/url/m3u", () => ({
  generateM3U: mocks.generateM3U,
}));

vi.mock("$lib/utils/qrcode", () => ({
  generateQRCodeDataUri: mocks.generateQRCodeDataUri,
}));

vi.mock("$lib/dispatcharr/client", () => ({
  DispatcharrClient: mocks.DispatcharrClient,
}));

vi.mock("$lib/dispatcharr/endpoints/channels", () => ({
  createChannelEndpoints: mocks.createChannelEndpoints,
}));

vi.mock("$lib/server/auth", () => ({
  isSecure: false,
}));

const envState = vi.hoisted(() => ({
  ORIGIN: "",
}));

vi.mock("$env/dynamic/private", () => ({
  env: envState,
}));

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
    dispatcharr_xc_password_enc: "encrypted-pw",
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

function createCookies() {
  const set = vi.fn();
  const deleteFn = vi.fn();
  const get = vi.fn((name: string) => {
    if (name === "otpravkarr_initial_password") return state.initialPasswordCookie;
    return undefined;
  });
  return {
    cookies: { set, get, delete: deleteFn },
    set,
    deleteFn,
  };
}

function resetAll() {
  state.limiterAllowed = true;
  state.configValues = {
    dispatcharr_url: "http://dispatcharr.local",
    dispatcharr_api_key: "api-key-123",
  };
  state.user = null;
  state.initialPasswordCookie = undefined;
  envState.ORIGIN = "";

  for (const fn of Object.values(mocks)) {
    if (typeof fn === "function" && "mockClear" in fn) {
      (fn as ReturnType<typeof vi.fn>).mockClear();
    }
  }
}

describe("portal page server", () => {
  beforeEach(() => {
    resetAll();
  });

  // ── load ──

  describe("load", () => {
    it("returns unauthenticated when no user in locals", async () => {
      const { load } = await import("./+page.server");
      const { cookies } = createCookies();

      const result = await load({
        locals: {},
        cookies,
      } as unknown as Parameters<typeof load>[0]);

      expect(result).toEqual({ authenticated: false });
    });

    it("returns revoked status for inactive user", async () => {
      const { load } = await import("./+page.server");
      const user = createUser({ is_active: 0 });
      const { cookies } = createCookies();

      const result = await load({
        locals: { user },
        cookies,
      } as unknown as Parameters<typeof load>[0]);

      expect(result).toEqual({ authenticated: true, revoked: true });
      expect(mocks.updateLastAccessed).not.toHaveBeenCalled();
    });

    it("returns dispatcharr info for self-managed user", async () => {
      const { load } = await import("./+page.server");
      const user = createUser({ provisioning_mode: "self_managed" });
      state.configValues.dispatcharr_url = "http://dispatcharr.local";
      const { cookies } = createCookies();

      const result = await load({
        locals: { user },
        cookies,
      } as unknown as Parameters<typeof load>[0]);

      expect(result).toMatchObject({
        authenticated: true,
        mode: "self_managed",
        dispatcharrUsername: "testuser",
        dispatcharrUrl: "http://dispatcharr.local",
        initialPassword: null,
      });
      expect(mocks.updateLastAccessed).toHaveBeenCalledWith(1);
    });

    it("returns and clears one-time initial password for self-managed user", async () => {
      const { load } = await import("./+page.server");
      const user = createUser({ provisioning_mode: "self_managed" });
      state.configValues.dispatcharr_url = "http://dispatcharr.local";
      state.initialPasswordCookie = "TempPassword!23";
      const { cookies, deleteFn } = createCookies();

      const result = await load({
        locals: { user },
        cookies,
      } as unknown as Parameters<typeof load>[0]);

      expect(result).toMatchObject({
        authenticated: true,
        mode: "self_managed",
        initialPassword: "TempPassword!23",
      });
      expect(deleteFn).toHaveBeenCalledWith("otpravkarr_initial_password", { path: "/" });
    });

    it("returns error when automatic user has no credentials", async () => {
      const { load } = await import("./+page.server");
      const user = createUser({ dispatcharr_xc_password_enc: null });
      const { cookies } = createCookies();

      const result = await load({
        locals: { user },
        cookies,
      } as unknown as Parameters<typeof load>[0]);

      expect(result).toMatchObject({
        authenticated: true,
        mode: "automatic",
        error: expect.stringContaining("not yet provisioned"),
      });
    });

    it("returns streaming URLs for automatic user with credentials", async () => {
      const { load } = await import("./+page.server");
      const user = createUser();
      state.configValues.dispatcharr_url = "http://dispatcharr.local";
      const { cookies } = createCookies();

      const result = await load({
        locals: { user },
        cookies,
      } as unknown as Parameters<typeof load>[0]);

      expect(result).toMatchObject({
        authenticated: true,
        mode: "automatic",
        xcUrl: expect.any(String),
        playerApiUrl: expect.any(String),
        qrCodeDataUri: expect.any(String),
        platformUrls: expect.any(Array),
        dispatcharrUsername: "testuser",
      });
      expect(mocks.decrypt).toHaveBeenCalledWith("encrypted-pw", "credential-encryption");
      expect(mocks.updateLastAccessed).toHaveBeenCalledWith(1);
    });

    it("calls updateLastAccessed for active users", async () => {
      const { load } = await import("./+page.server");
      const user = createUser();
      const { cookies } = createCookies();

      await load({
        locals: { user },
        cookies,
      } as unknown as Parameters<typeof load>[0]);

      expect(mocks.updateLastAccessed).toHaveBeenCalledWith(1);
    });
  });

  // ── signInWithPlex ──

  describe("signInWithPlex action", () => {
    it("returns 429 when rate limited", async () => {
      state.limiterAllowed = false;
      const { actions } = await import("./+page.server");
      const action = actions.signInWithPlex;
      if (!action) throw new Error("signInWithPlex action is undefined");

      const { cookies } = createCookies();
      const result = await action({
        url: new URL("http://localhost"),
        cookies,
        getClientAddress: () => "127.0.0.1",
      } as unknown as Parameters<typeof action>[0]);

      expect(result).toMatchObject({
        status: 429,
        data: { error: "rate_limited" },
      });
      expect(mocks.initiateOAuth).not.toHaveBeenCalled();
    });

    it("initiates OAuth, sets cookie, and redirects", async () => {
      const { actions } = await import("./+page.server");
      const action = actions.signInWithPlex;
      if (!action) throw new Error("signInWithPlex action is undefined");

      const { cookies, set } = createCookies();
      await expect(
        action({
          url: new URL("http://localhost"),
          cookies,
          getClientAddress: () => "127.0.0.1",
        } as unknown as Parameters<typeof action>[0]),
      ).rejects.toMatchObject({
        status: 303,
        location: "https://app.plex.tv/auth#?clientID=xxx&code=yyy",
      });

      expect(mocks.initiateOAuth).toHaveBeenCalledWith("http://localhost/auth/plex");
      expect(set).toHaveBeenCalledWith(
        "otpravkarr_oauth_id",
        "oauth-pin-id",
        expect.objectContaining({
          path: "/",
          httpOnly: true,
          maxAge: 600,
        }),
      );
    });

    it("returns 502 on PlexAuthError", async () => {
      const { PlexAuthError } = await import("$lib/plex/types");
      mocks.initiateOAuth.mockRejectedValueOnce(new PlexAuthError("Plex is down"));

      const { actions } = await import("./+page.server");
      const action = actions.signInWithPlex;
      if (!action) throw new Error("signInWithPlex action is undefined");

      const { cookies } = createCookies();
      const result = await action({
        url: new URL("http://localhost"),
        cookies,
        getClientAddress: () => "127.0.0.1",
      } as unknown as Parameters<typeof action>[0]);

      expect(result).toMatchObject({
        status: 502,
        data: { error: "plex_error", message: "Plex is down" },
      });
    });

    it("uses ORIGIN env when configured", async () => {
      envState.ORIGIN = "https://public.example.com";

      const { actions } = await import("./+page.server");
      const action = actions.signInWithPlex;
      if (!action) throw new Error("signInWithPlex action is undefined");

      const { cookies } = createCookies();
      try {
        await action({
          url: new URL("http://localhost:5173"),
          cookies,
          getClientAddress: () => "127.0.0.1",
        } as unknown as Parameters<typeof action>[0]);
      } catch {
        // redirect expected
      }

      expect(mocks.initiateOAuth).toHaveBeenCalledWith("https://public.example.com/auth/plex");
    });

    it("uses configured origin when ORIGIN is a stale loopback (avoids Host header influence)", async () => {
      envState.ORIGIN = "http://localhost:3000";

      const { actions } = await import("./+page.server");
      const action = actions.signInWithPlex;
      if (!action) throw new Error("signInWithPlex action is undefined");

      const { cookies } = createCookies();
      try {
        await action({
          url: new URL("http://127.0.0.1:5173"),
          cookies,
          getClientAddress: () => "127.0.0.1",
        } as unknown as Parameters<typeof action>[0]);
      } catch {
        // redirect expected
      }

      expect(mocks.initiateOAuth).toHaveBeenCalledWith("http://localhost:3000/auth/plex");
    });
  });

  // ── refreshCredentials ──

  describe("refreshCredentials action", () => {
    it("returns 401 when unauthenticated", async () => {
      const { actions } = await import("./+page.server");
      const action = actions.refreshCredentials;
      if (!action) throw new Error("refreshCredentials action is undefined");

      const result = await action({
        locals: {},
      } as unknown as Parameters<typeof action>[0]);

      expect(result).toMatchObject({
        status: 401,
        data: { error: "not_authenticated" },
      });
    });

    it("returns 400 for non-automatic mode", async () => {
      const { actions } = await import("./+page.server");
      const action = actions.refreshCredentials;
      if (!action) throw new Error("refreshCredentials action is undefined");

      const result = await action({
        locals: { user: createUser({ provisioning_mode: "self_managed" }) },
      } as unknown as Parameters<typeof action>[0]);

      expect(result).toMatchObject({
        status: 400,
        data: { error: "not_automatic_mode" },
      });
    });

    it("returns 400 for inactive user", async () => {
      const { actions } = await import("./+page.server");
      const action = actions.refreshCredentials;
      if (!action) throw new Error("refreshCredentials action is undefined");

      const result = await action({
        locals: { user: createUser({ is_active: 0 }) },
      } as unknown as Parameters<typeof action>[0]);

      expect(result).toMatchObject({
        status: 400,
        data: { error: "not_allowed" },
      });
      expect(mocks.rotateCredentials).not.toHaveBeenCalled();
    });

    it("returns 500 when config is missing", async () => {
      state.configValues = {};
      const { actions } = await import("./+page.server");
      const action = actions.refreshCredentials;
      if (!action) throw new Error("refreshCredentials action is undefined");

      const result = await action({
        locals: { user: createUser() },
      } as unknown as Parameters<typeof action>[0]);

      expect(result).toMatchObject({
        status: 500,
        data: { error: "config_missing" },
      });
    });

    it("redirects on successful rotation", async () => {
      const { actions } = await import("./+page.server");
      const action = actions.refreshCredentials;
      if (!action) throw new Error("refreshCredentials action is undefined");

      await expect(
        action({
          locals: { user: createUser() },
        } as unknown as Parameters<typeof action>[0]),
      ).rejects.toMatchObject({
        status: 303,
        location: "/",
      });

      expect(mocks.rotateCredentials).toHaveBeenCalled();
    });

    it("returns 500 on rotation failure", async () => {
      mocks.rotateCredentials.mockRejectedValueOnce(new Error("Rotation failed"));

      const { actions } = await import("./+page.server");
      const action = actions.refreshCredentials;
      if (!action) throw new Error("refreshCredentials action is undefined");

      const result = await action({
        locals: { user: createUser() },
      } as unknown as Parameters<typeof action>[0]);

      expect(result).toMatchObject({
        status: 500,
        data: { error: "refresh_failed", message: "Rotation failed" },
      });
    });
  });

  // ── downloadM3U ──

  describe("downloadM3U action", () => {
    it("returns 401 when unauthenticated", async () => {
      const { actions } = await import("./+page.server");
      const action = actions.downloadM3U;
      if (!action) throw new Error("downloadM3U action is undefined");

      const result = await action({
        locals: {},
      } as unknown as Parameters<typeof action>[0]);

      expect(result).toMatchObject({
        status: 401,
        data: { error: "not_authenticated" },
      });
    });

    it("returns 400 for non-automatic mode", async () => {
      const { actions } = await import("./+page.server");
      const action = actions.downloadM3U;
      if (!action) throw new Error("downloadM3U action is undefined");

      const result = await action({
        locals: { user: createUser({ provisioning_mode: "self_managed" }) },
      } as unknown as Parameters<typeof action>[0]);

      expect(result).toMatchObject({
        status: 400,
        data: { error: "not_allowed" },
      });
    });

    it("returns 400 for inactive user", async () => {
      const { actions } = await import("./+page.server");
      const action = actions.downloadM3U;
      if (!action) throw new Error("downloadM3U action is undefined");

      const result = await action({
        locals: { user: createUser({ is_active: 0 }) },
      } as unknown as Parameters<typeof action>[0]);

      expect(result).toMatchObject({
        status: 400,
        data: { error: "not_allowed" },
      });
    });

    it("returns 400 when no credentials", async () => {
      const { actions } = await import("./+page.server");
      const action = actions.downloadM3U;
      if (!action) throw new Error("downloadM3U action is undefined");

      const result = await action({
        locals: { user: createUser({ dispatcharr_xc_password_enc: null }) },
      } as unknown as Parameters<typeof action>[0]);

      expect(result).toMatchObject({
        status: 400,
        data: { error: "no_credentials" },
      });
    });

    it("returns 500 when config is missing", async () => {
      state.configValues = {};
      const { actions } = await import("./+page.server");
      const action = actions.downloadM3U;
      if (!action) throw new Error("downloadM3U action is undefined");

      const result = await action({
        locals: { user: createUser() },
      } as unknown as Parameters<typeof action>[0]);

      expect(result).toMatchObject({
        status: 500,
        data: { error: "config_missing" },
      });
    });

    it("returns m3u content on success", async () => {
      const { actions } = await import("./+page.server");
      const action = actions.downloadM3U;
      if (!action) throw new Error("downloadM3U action is undefined");

      const result = await action({
        locals: { user: createUser() },
      } as unknown as Parameters<typeof action>[0]);

      expect(result).toMatchObject({
        m3uContent: expect.stringContaining("#EXTM3U"),
      });
      expect(mocks.decrypt).toHaveBeenCalledWith("encrypted-pw", "credential-encryption");
      expect(mocks.generateM3U).toHaveBeenCalled();
    });

    it("returns 500 when channels fetch fails", async () => {
      mocks.createChannelEndpoints.mockReturnValueOnce({
        getAllChannels: vi.fn(
          async (): Promise<DispatcharrResult<DispatcharrChannel[]>> => ({
            ok: false as const,
            error: "server_error",
            message: "API error",
          }),
        ),
      });

      const { actions } = await import("./+page.server");
      const action = actions.downloadM3U;
      if (!action) throw new Error("downloadM3U action is undefined");

      const result = await action({
        locals: { user: createUser() },
      } as unknown as Parameters<typeof action>[0]);

      expect(result).toMatchObject({
        status: 500,
        data: { error: "channels_failed", message: "API error" },
      });
    });
  });
});
