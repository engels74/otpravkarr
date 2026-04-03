// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  configValues: new Map<string, string>(),
  validateTokenResult: true,
  limiterAllowed: true,
  env: {
    ORIGIN: "http://localhost:3000",
  },
}));

const mocks = vi.hoisted(() => ({
  consumeBootstrapToken: vi.fn((_: string) => state.validateTokenResult),
  clearBootstrapToken: vi.fn(),
  getConfig: vi.fn(async (key: string) => state.configValues.get(key) ?? null),
  setConfig: vi.fn(async (key: string, value: string) => {
    state.configValues.set(key, value);
  }),
  setupLimiterCheck: vi.fn((_: string) => ({ allowed: state.limiterAllowed })),
  requireSetupIncomplete: vi.fn(),
  hashAdminPassword: vi.fn(async () => "hashed-password"),
  createAdmin: vi.fn(),
  appendAuditLog: vi.fn(),
  createSession: vi.fn(() => "session-id"),
}));

vi.mock("$lib/crypto/bootstrap", () => ({
  clearBootstrapToken: mocks.clearBootstrapToken,
  consumeBootstrapToken: mocks.consumeBootstrapToken,
}));

vi.mock("$env/dynamic/private", () => ({
  env: state.env,
}));

vi.mock("$lib/crypto/passwords", () => ({
  hashAdminPassword: mocks.hashAdminPassword,
}));

vi.mock("$lib/db/repositories/admin", () => ({
  createAdmin: mocks.createAdmin,
}));

vi.mock("$lib/db/repositories/audit", () => ({
  appendAuditLog: mocks.appendAuditLog,
}));

vi.mock("$lib/db/repositories/config", () => ({
  getConfig: mocks.getConfig,
  setConfig: mocks.setConfig,
}));

vi.mock("$lib/db/repositories/sessions", () => ({
  createSession: mocks.createSession,
}));

vi.mock("$lib/db/types", () => ({
  AuditAction: {
    SETUP_COMPLETED: "SETUP_COMPLETED",
  },
}));

vi.mock("$lib/dispatcharr/client", () => ({
  DispatcharrClient: vi.fn(),
}));

vi.mock("$lib/dispatcharr/endpoints/groups", () => ({
  listGroups: vi.fn(async () => ({ ok: true, data: [] })),
}));

vi.mock("$lib/dispatcharr/endpoints/health", () => ({
  createHealthEndpoints: vi.fn(() => ({
    checkHealth: vi.fn(async () => ({
      ok: true,
      data: { reachable: true, authValid: true },
    })),
  })),
}));

vi.mock("$lib/dispatcharr/endpoints/profiles", () => ({
  listProfiles: vi.fn(async () => ({ ok: true, data: [] })),
}));

vi.mock("$lib/plex/client", () => ({
  validateServerToken: vi.fn(async () => ({
    friendlyName: "Plex",
    machineIdentifier: "mid",
    version: "1.0",
  })),
}));

vi.mock("$lib/plex/oauth", () => ({
  completeOAuth: vi.fn(async () => ({
    id: 1,
    uuid: "plex-uuid",
    username: "plex-user",
    email: "plex@example.com",
    thumb: "",
    authenticationToken: "plex-auth-token",
  })),
  initiateOAuth: vi.fn(),
}));

vi.mock("$lib/plex/types", () => ({
  PlexAuthError: class PlexAuthError extends Error {},
  PlexConnectionError: class PlexConnectionError extends Error {},
}));

vi.mock("$lib/server/auth", () => ({
  ADMIN_COOKIE_OPTIONS: {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    maxAge: 3600,
  },
  ADMIN_SESSION_TTL: 3600,
  requireSetupIncomplete: mocks.requireSetupIncomplete,
  SESSION_COOKIE_NAME: "otpravkarr_session",
}));

vi.mock("$lib/server/ratelimit", () => ({
  setupLimiter: {
    check: mocks.setupLimiterCheck,
  },
}));

vi.mock("$lib/url/discover", () => ({
  probeXcSurface: vi.fn(async () => null),
}));

const setupClaimedKey = "setup_claimed";
const setupClaimProofKey = "setup_claim_proof";
const setupClaimedAtKey = "setup_claimed_at";
const setupClaimCookie = "otpravkarr_setup_claim";
const setupClaimTtlMs = 10 * 60 * 1000;
const postSetupRedirectLocation = "/dashboard";
const setupPrerequisiteConfig = {
  plex_server_url: "http://plex.local",
  plex_admin_token: "plex-admin-token",
  plex_machine_id: "plex-machine-id",
  dispatcharr_url: "http://dispatcharr.local",
  dispatcharr_api_key: "dispatcharr-api-key",
  allowed_origins: JSON.stringify(["http://localhost:3000"]),
} as const;

type CookieSetCall = {
  name: string;
  value: string;
  options: unknown;
};

function createCookies(initial: Record<string, string> = {}) {
  const jar = new Map<string, string>(Object.entries(initial));
  const setCalls: CookieSetCall[] = [];

  return {
    cookies: {
      get: (name: string) => jar.get(name),
      set: (name: string, value: string, options: unknown) => {
        jar.set(name, value);
        setCalls.push({ name, value, options });
      },
      delete: (name: string) => {
        jar.delete(name);
      },
    },
    setCalls,
    jar,
  };
}

function resetStateAndMocks() {
  state.configValues.clear();
  state.validateTokenResult = true;
  state.limiterAllowed = true;
  state.env.ORIGIN = "http://localhost:3000";

  mocks.consumeBootstrapToken.mockClear();
  mocks.clearBootstrapToken.mockClear();
  mocks.getConfig.mockClear();
  mocks.setConfig.mockClear();
  mocks.setupLimiterCheck.mockClear();
  mocks.requireSetupIncomplete.mockClear();
  mocks.hashAdminPassword.mockClear();
  mocks.createAdmin.mockClear();
  mocks.appendAuditLog.mockClear();
  mocks.createSession.mockClear();
}

describe("setup claim ownership", () => {
  beforeEach(() => {
    resetStateAndMocks();
  });

  it("marks claimActive on load when claim cookie matches stored proof", async () => {
    state.configValues.set(setupClaimedKey, "true");
    state.configValues.set(setupClaimProofKey, "proof-123");
    state.configValues.set(setupClaimedAtKey, String(Date.now()));
    const { cookies } = createCookies({ [setupClaimCookie]: "proof-123" });

    const { load } = await import("./+page.server");
    const result = await load({
      url: new URL("http://localhost/setup"),
      cookies,
    } as unknown as Parameters<typeof load>[0]);

    expect(result).toMatchObject({
      claimActive: true,
      tokenProvided: false,
    });
    expect(mocks.requireSetupIncomplete).toHaveBeenCalledOnce();
  });

  it("blocks setup actions when instance is claimed by a different requester", async () => {
    state.configValues.set(setupClaimedKey, "true");
    state.configValues.set(setupClaimProofKey, "owner-proof");
    state.configValues.set(setupClaimedAtKey, String(Date.now()));
    const { cookies } = createCookies();

    const body = new FormData();
    body.set("username", "admin");
    body.set("password", "passwordpassword");
    body.set("confirmPassword", "passwordpassword");

    const request = new Request("http://localhost/setup", { method: "POST", body });

    const { actions } = await import("./+page.server");
    const createAdmin = actions.createAdmin;
    if (!createAdmin) {
      throw new Error("createAdmin action is undefined");
    }

    const result = await createAdmin({
      request,
      cookies,
    } as unknown as Parameters<typeof createAdmin>[0]);

    expect(result).toMatchObject({
      status: 403,
      data: { error: "setup_not_claimed" },
    });
  });

  it("stores claimant proof and cookie when token claim succeeds", async () => {
    const claimProof = "11111111-1111-1111-1111-111111111111";
    const randomUuidSpy = vi.spyOn(crypto, "randomUUID").mockReturnValue(claimProof);
    const { cookies, setCalls } = createCookies();

    const body = new FormData();
    body.set("token", "valid-token");
    const request = new Request("http://localhost/setup", { method: "POST", body });

    const { actions } = await import("./+page.server");
    const claimInstance = actions.claimInstance;
    if (!claimInstance) {
      throw new Error("claimInstance action is undefined");
    }

    const result = await claimInstance({
      request,
      getClientAddress: () => "127.0.0.1",
      cookies,
    } as unknown as Parameters<typeof claimInstance>[0]);

    expect(result).toEqual({ success: true });
    expect(mocks.consumeBootstrapToken).toHaveBeenCalledWith("valid-token");
    expect(state.configValues.get(setupClaimedKey)).toBe("true");
    expect(state.configValues.get(setupClaimProofKey)).toBe(claimProof);
    expect(Number(state.configValues.get(setupClaimedAtKey))).toBeGreaterThan(0);
    expect(setCalls).toContainEqual(
      expect.objectContaining({
        name: setupClaimCookie,
        value: claimProof,
      }),
    );

    randomUuidSpy.mockRestore();
  });

  it("rejects reclaiming setup with a consumed bootstrap token when the claim cookie is missing", async () => {
    state.configValues.set(setupClaimedKey, "true");
    state.configValues.set(setupClaimProofKey, "owner-proof");
    state.configValues.set(setupClaimedAtKey, String(Date.now()));
    state.validateTokenResult = false;

    const { cookies, setCalls } = createCookies();
    const body = new FormData();
    body.set("token", "valid-token");
    const request = new Request("http://localhost/setup", { method: "POST", body });

    const { actions } = await import("./+page.server");
    const claimInstance = actions.claimInstance;
    if (!claimInstance) {
      throw new Error("claimInstance action is undefined");
    }

    const result = await claimInstance({
      request,
      getClientAddress: () => "127.0.0.1",
      cookies,
    } as unknown as Parameters<typeof claimInstance>[0]);

    expect(result).toMatchObject({
      status: 400,
      data: { error: "invalid_token" },
    });
    expect(mocks.consumeBootstrapToken).toHaveBeenCalledWith("valid-token");
    expect(state.configValues.get(setupClaimProofKey)).toBe("owner-proof");
    expect(setCalls).toHaveLength(0);
  });

  it("rejects reclaiming setup with a consumed bootstrap token after the claim expires", async () => {
    state.configValues.set(setupClaimedKey, "true");
    state.configValues.set(setupClaimProofKey, "owner-proof");
    const staleClaimedAt = Date.now() - setupClaimTtlMs - 1;
    state.configValues.set(setupClaimedAtKey, String(staleClaimedAt));
    state.validateTokenResult = false;
    const { cookies, setCalls } = createCookies({ [setupClaimCookie]: "owner-proof" });

    const body = new FormData();
    body.set("token", "valid-token");
    const request = new Request("http://localhost/setup", { method: "POST", body });

    const { load, actions } = await import("./+page.server");
    const loadResult = await load({
      url: new URL("http://localhost/setup"),
      cookies,
    } as unknown as Parameters<typeof load>[0]);
    expect(loadResult).toMatchObject({
      claimActive: false,
    });

    const claimInstance = actions.claimInstance;
    if (!claimInstance) {
      throw new Error("claimInstance action is undefined");
    }

    const result = await claimInstance({
      request,
      getClientAddress: () => "127.0.0.1",
      cookies,
    } as unknown as Parameters<typeof claimInstance>[0]);

    expect(result).toMatchObject({
      status: 400,
      data: { error: "invalid_token" },
    });
    expect(mocks.consumeBootstrapToken).toHaveBeenCalledWith("valid-token");
    expect(state.configValues.get(setupClaimProofKey)).toBe("owner-proof");
    expect(state.configValues.get(setupClaimedAtKey)).toBe(String(staleClaimedAt));
    expect(setCalls).toHaveLength(0);
  });
});

describe("setDefaults", () => {
  beforeEach(() => {
    resetStateAndMocks();
    state.configValues.set(setupClaimedKey, "true");
    state.configValues.set(setupClaimProofKey, "proof-123");
    state.configValues.set(setupClaimedAtKey, String(Date.now()));
  });

  it("rejects setup completion when required prior steps are missing", async () => {
    const { cookies } = createCookies({ [setupClaimCookie]: "proof-123" });
    const body = new FormData();
    body.set("defaultGroupId", "10");
    body.set("defaultProfileId", "20");
    body.set("syncInterval", "15");
    body.set("defaultProvisioningMode", "automatic");
    body.set("adminUsername", "admin");
    body.set("adminPassword", "passwordpassword");

    const request = new Request("http://localhost/setup", { method: "POST", body });

    const { actions } = await import("./+page.server");
    const setDefaults = actions.setDefaults;
    if (!setDefaults) {
      throw new Error("setDefaults action is undefined");
    }

    const result = await setDefaults({
      request,
      cookies,
      getClientAddress: () => "127.0.0.1",
    } as unknown as Parameters<typeof setDefaults>[0]);

    expect(result).toMatchObject({
      status: 400,
      data: {
        error: "Complete Plex, Dispatcharr, and origin setup before finishing setup",
        field: "defaults",
      },
    });
    expect(result).toMatchObject({
      data: {
        missingPrerequisites: expect.arrayContaining([
          "plex_server_url",
          "plex_admin_token",
          "plex_machine_id",
          "dispatcharr_url",
          "dispatcharr_api_key",
          "allowed_origins",
        ]),
      },
    });
    expect(mocks.hashAdminPassword).not.toHaveBeenCalled();
    expect(mocks.createAdmin).not.toHaveBeenCalled();
    expect(mocks.clearBootstrapToken).not.toHaveBeenCalled();
  });

  it("clears the bootstrap token after setup completes", async () => {
    for (const [key, value] of Object.entries(setupPrerequisiteConfig)) {
      state.configValues.set(key, value);
    }

    const { cookies, setCalls } = createCookies({ [setupClaimCookie]: "proof-123" });
    const body = new FormData();
    body.set("defaultGroupId", "10");
    body.set("defaultProfileId", "20");
    body.set("syncInterval", "15");
    body.set("defaultProvisioningMode", "automatic");
    body.set("adminUsername", "admin");
    body.set("adminPassword", "passwordpassword");

    const request = new Request("http://localhost/setup", { method: "POST", body });

    const { actions } = await import("./+page.server");
    const setDefaults = actions.setDefaults;
    if (!setDefaults) {
      throw new Error("setDefaults action is undefined");
    }

    await expect(
      setDefaults({
        request,
        cookies,
        getClientAddress: () => "127.0.0.1",
      } as unknown as Parameters<typeof setDefaults>[0]),
    ).rejects.toMatchObject({
      status: 303,
      location: postSetupRedirectLocation,
    });

    expect(mocks.clearBootstrapToken).toHaveBeenCalledOnce();
    expect(mocks.hashAdminPassword).toHaveBeenCalledWith("passwordpassword");
    expect(mocks.createAdmin).toHaveBeenCalledWith("admin", "hashed-password");
    expect(mocks.createSession).toHaveBeenCalledWith("admin", "admin", 3600);
    expect(mocks.appendAuditLog).toHaveBeenCalledOnce();
    expect(state.configValues.get(setupClaimedAtKey)).toBe("");
    expect(setCalls).toContainEqual(
      expect.objectContaining({
        name: "otpravkarr_session",
        value: "session-id",
      }),
    );
  });
});

describe("configurePlex oauth initiate origin selection", () => {
  beforeEach(() => {
    resetStateAndMocks();
    state.configValues.set(setupClaimedKey, "true");
    state.configValues.set(setupClaimProofKey, "proof-123");
    state.configValues.set(setupClaimedAtKey, String(Date.now()));
  });

  it("uses ORIGIN when configured for OAuth forward URL", async () => {
    state.env.ORIGIN = "https://public.example.com";
    const { cookies } = createCookies({ [setupClaimCookie]: "proof-123" });

    const body = new FormData();
    body.set("plexMode", "oauth_initiate");
    const request = new Request("http://127.0.0.1:3000/setup", { method: "POST", body });

    const oauth = await import("$lib/plex/oauth");
    vi.mocked(oauth.initiateOAuth).mockResolvedValue({
      id: "oauth-id",
      uri: "https://app.plex.tv/auth",
    });

    const { actions } = await import("./+page.server");
    const configurePlex = actions.configurePlex;
    if (!configurePlex) {
      throw new Error("configurePlex action is undefined");
    }

    const result = await configurePlex({
      request,
      url: new URL("http://127.0.0.1:3000/setup"),
      cookies,
    } as unknown as Parameters<typeof configurePlex>[0]);

    expect(result).toMatchObject({
      success: true,
      oauthId: "oauth-id",
      oauthUri: "https://app.plex.tv/auth",
    });
    expect(oauth.initiateOAuth).toHaveBeenCalledWith("https://public.example.com/setup");
  });

  it("falls back to request origin when ORIGIN is unset", async () => {
    state.env.ORIGIN = "";
    const { cookies } = createCookies({ [setupClaimCookie]: "proof-123" });

    const body = new FormData();
    body.set("plexMode", "oauth_initiate");
    const request = new Request("http://127.0.0.1:3000/setup", { method: "POST", body });

    const oauth = await import("$lib/plex/oauth");
    vi.mocked(oauth.initiateOAuth).mockResolvedValue({
      id: "oauth-id",
      uri: "https://app.plex.tv/auth",
    });

    const { actions } = await import("./+page.server");
    const configurePlex = actions.configurePlex;
    if (!configurePlex) {
      throw new Error("configurePlex action is undefined");
    }

    await configurePlex({
      request,
      url: new URL("http://127.0.0.1:3000/setup"),
      cookies,
    } as unknown as Parameters<typeof configurePlex>[0]);

    expect(oauth.initiateOAuth).toHaveBeenCalledWith("http://127.0.0.1:3000/setup");
  });
});

describe("configurePlex oauth completion retries", () => {
  beforeEach(() => {
    resetStateAndMocks();
    state.configValues.set(setupClaimedKey, "true");
    state.configValues.set(setupClaimProofKey, "proof-123");
    state.configValues.set(setupClaimedAtKey, String(Date.now()));
  });

  it("allows retrying oauth completion after Plex server validation fails once", async () => {
    const { cookies } = createCookies({ [setupClaimCookie]: "proof-123" });
    const oauth = await import("$lib/plex/oauth");
    const plexClient = await import("$lib/plex/client");
    const plexTypes = await import("$lib/plex/types");

    vi.mocked(oauth.completeOAuth).mockResolvedValue({
      id: 1,
      uuid: "plex-uuid",
      username: "plex-user",
      email: "plex@example.com",
      thumb: "",
      authenticationToken: "plex-auth-token",
    });
    vi.mocked(plexClient.validateServerToken)
      .mockRejectedValueOnce(new plexTypes.PlexConnectionError("temporary validation failure"))
      .mockResolvedValueOnce({
        friendlyName: "Plex",
        machineIdentifier: "mid",
        version: "1.0",
      });

    const body = new FormData();
    body.set("plexMode", "oauth_complete");
    body.set("oauthId", "oauth-id");
    body.set("plexServerUrl", "http://plex.local");

    const request = new Request("http://localhost/setup", { method: "POST", body });

    const { actions } = await import("./+page.server");
    const configurePlex = actions.configurePlex;
    if (!configurePlex) {
      throw new Error("configurePlex action is undefined");
    }

    const firstResult = await configurePlex({
      request,
      url: new URL("http://localhost/setup"),
      cookies,
    } as unknown as Parameters<typeof configurePlex>[0]);

    expect(firstResult).toMatchObject({
      status: 400,
      data: { error: "temporary validation failure" },
    });

    const retryBody = new FormData();
    retryBody.set("plexMode", "oauth_complete");
    retryBody.set("oauthId", "oauth-id");
    retryBody.set("plexServerUrl", "http://plex.local");

    const retryRequest = new Request("http://localhost/setup", { method: "POST", body: retryBody });

    const retryResult = await configurePlex({
      request: retryRequest,
      url: new URL("http://localhost/setup"),
      cookies,
    } as unknown as Parameters<typeof configurePlex>[0]);

    expect(retryResult).toMatchObject({
      success: true,
      friendlyName: "Plex",
      machineIdentifier: "mid",
      version: "1.0",
    });
    expect(oauth.completeOAuth).toHaveBeenCalledTimes(2);
    expect(plexClient.validateServerToken).toHaveBeenCalledTimes(2);
  });
});
