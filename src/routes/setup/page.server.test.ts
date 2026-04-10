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
  validateBootstrapToken: vi.fn((_: string) => state.validateTokenResult),
  clearBootstrapToken: vi.fn(),
  getConfig: vi.fn(async (key: string) => state.configValues.get(key) ?? null),
  setConfig: vi.fn(async (key: string, value: string) => {
    state.configValues.set(key, value);
  }),
  setupLimiterCheck: vi.fn((_: string) => ({ allowed: state.limiterAllowed })),
  requireSetupIncomplete: vi.fn(),
  hashAdminPassword: vi.fn(async () => "hashed-password"),
  createAdmin: vi.fn(),
  adminExists: vi.fn(() => false),
  appendAuditLog: vi.fn(),
  createSession: vi.fn(() => "session-id"),
}));

vi.mock("$lib/crypto/bootstrap", () => ({
  clearBootstrapToken: mocks.clearBootstrapToken,
  validateBootstrapToken: mocks.validateBootstrapToken,
}));

vi.mock("$env/dynamic/private", () => ({
  env: state.env,
}));

vi.mock("$lib/crypto/passwords", () => ({
  hashAdminPassword: mocks.hashAdminPassword,
}));

vi.mock("$lib/db/repositories/admin", () => ({
  createAdmin: mocks.createAdmin,
  adminExists: mocks.adminExists,
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

vi.mock("$lib/scheduler/jobs/health", () => ({
  seedInitialHealth: vi.fn(),
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
  PlexAuthError: class PlexAuthError extends Error {
    override readonly name = "PlexAuthError" as const;
  },
  PlexConnectionError: class PlexConnectionError extends Error {
    override readonly name = "PlexConnectionError" as const;
  },
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
  isSecure: true,
  requireSetupIncomplete: mocks.requireSetupIncomplete,
  SETUP_COMPLETED_CONFIG_KEY: "setup_completed",
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

vi.mock("$lib/utils/retry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/utils/retry")>();
  return {
    ...actual,
    sleep: vi.fn().mockResolvedValue(undefined),
    retryAsync: async <T>(
      fn: () => Promise<T>,
      shouldRetry?: (error: unknown) => boolean,
      options?: import("$lib/utils/retry").RetryOptions,
    ): Promise<T> => {
      const config = { ...actual.DEFAULT_RETRY_CONFIG, ...options };
      let lastError: unknown;
      for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
        try {
          return await fn();
        } catch (error: unknown) {
          lastError = error;
          if (shouldRetry && !shouldRetry(error)) {
            throw error;
          }
        }
      }
      throw lastError;
    },
  };
});

const setupClaimedKey = "setup_claimed";
const setupClaimProofKey = "setup_claim_proof";
const setupClaimedAtKey = "setup_claimed_at";
const setupCompletedKey = "setup_completed";
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

  mocks.validateBootstrapToken.mockClear();
  mocks.clearBootstrapToken.mockClear();
  mocks.getConfig.mockClear();
  mocks.setConfig.mockClear();
  mocks.setupLimiterCheck.mockClear();
  mocks.requireSetupIncomplete.mockClear();
  mocks.hashAdminPassword.mockClear();
  mocks.createAdmin.mockClear();
  mocks.adminExists.mockClear().mockReturnValue(false);
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
      resumePhase: 1,
      dispatcharrGroups: [],
      dispatcharrProfiles: [],
      tokenProvided: false,
    });
    expect(mocks.requireSetupIncomplete).toHaveBeenCalledOnce();
  });

  it("resumes at Plex step when an admin already exists", async () => {
    mocks.adminExists.mockReturnValue(true);
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
      resumePhase: 2,
      dispatcharrGroups: [],
      dispatcharrProfiles: [],
      tokenProvided: false,
    });
  });

  it("resumes at origin step with persisted Dispatcharr setup on reload", async () => {
    mocks.adminExists.mockReturnValue(true);
    state.configValues.set(setupClaimedKey, "true");
    state.configValues.set(setupClaimProofKey, "proof-123");
    state.configValues.set(setupClaimedAtKey, String(Date.now()));
    state.configValues.set("plex_server_url", setupPrerequisiteConfig.plex_server_url);
    state.configValues.set("plex_admin_token", setupPrerequisiteConfig.plex_admin_token);
    state.configValues.set("plex_machine_id", setupPrerequisiteConfig.plex_machine_id);
    state.configValues.set("dispatcharr_url", setupPrerequisiteConfig.dispatcharr_url);
    state.configValues.set("dispatcharr_api_key", setupPrerequisiteConfig.dispatcharr_api_key);
    const { cookies } = createCookies({ [setupClaimCookie]: "proof-123" });

    const groups = await import("$lib/dispatcharr/endpoints/groups");
    const profiles = await import("$lib/dispatcharr/endpoints/profiles");
    vi.mocked(groups.listGroups).mockResolvedValueOnce({
      ok: true,
      data: [{ id: 10, name: "Group 10", permissions: [] }],
    });
    vi.mocked(profiles.listProfiles).mockResolvedValueOnce({
      ok: true,
      data: [{ id: 20, name: "Profile 20" }],
    });

    const { load } = await import("./+page.server");
    const result = await load({
      url: new URL("http://localhost/setup"),
      cookies,
    } as unknown as Parameters<typeof load>[0]);

    expect(result).toMatchObject({
      claimActive: true,
      resumePhase: 4,
      dispatcharrGroups: [{ id: 10, name: "Group 10" }],
      dispatcharrProfiles: [{ id: 20, name: "Profile 20" }],
      tokenProvided: false,
    });
  });

  it("resumes at defaults step after origin completion on reload", async () => {
    mocks.adminExists.mockReturnValue(true);
    state.configValues.set(setupClaimedKey, "true");
    state.configValues.set(setupClaimProofKey, "proof-123");
    state.configValues.set(setupClaimedAtKey, String(Date.now()));
    for (const [key, value] of Object.entries(setupPrerequisiteConfig)) {
      state.configValues.set(key, value);
    }
    const { cookies } = createCookies({ [setupClaimCookie]: "proof-123" });

    const groups = await import("$lib/dispatcharr/endpoints/groups");
    const profiles = await import("$lib/dispatcharr/endpoints/profiles");
    vi.mocked(groups.listGroups).mockResolvedValueOnce({
      ok: true,
      data: [{ id: 30, name: "Group 30", permissions: [] }],
    });
    vi.mocked(profiles.listProfiles).mockResolvedValueOnce({
      ok: true,
      data: [{ id: 40, name: "Profile 40" }],
    });

    const { load } = await import("./+page.server");
    const result = await load({
      url: new URL("http://localhost/setup"),
      cookies,
    } as unknown as Parameters<typeof load>[0]);

    expect(result).toMatchObject({
      claimActive: true,
      resumePhase: 5,
      dispatcharrGroups: [{ id: 30, name: "Group 30" }],
      dispatcharrProfiles: [{ id: 40, name: "Profile 40" }],
      tokenProvided: false,
    });
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
    expect(mocks.validateBootstrapToken).toHaveBeenCalledWith("valid-token");
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

  it("refreshes the existing claimant TTL for the active installer", async () => {
    state.configValues.set(setupClaimedKey, "true");
    state.configValues.set(setupClaimProofKey, "proof-123");
    const staleClaimedAt = Date.now() - 1_000;
    state.configValues.set(setupClaimedAtKey, String(staleClaimedAt));
    const { cookies, setCalls } = createCookies({ [setupClaimCookie]: "proof-123" });

    const request = new Request("http://localhost/setup", { method: "POST", body: new FormData() });

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
    expect(Number(state.configValues.get(setupClaimedAtKey))).toBeGreaterThan(staleClaimedAt);
    expect(setCalls).toContainEqual(
      expect.objectContaining({
        name: setupClaimCookie,
        value: "proof-123",
      }),
    );
    expect(mocks.validateBootstrapToken).not.toHaveBeenCalled();
  });

  it("rejects stealing an active setup claim even with a valid bootstrap token", async () => {
    state.configValues.set(setupClaimedKey, "true");
    state.configValues.set(setupClaimProofKey, "owner-proof");
    state.configValues.set(setupClaimedAtKey, String(Date.now()));

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
      status: 409,
      data: { error: "setup_claimed" },
    });
    expect(mocks.validateBootstrapToken).not.toHaveBeenCalled();
    expect(state.configValues.get(setupClaimProofKey)).toBe("owner-proof");
    expect(setCalls).toHaveLength(0);
  });

  it("rejects reclaiming setup with an invalid bootstrap token after the claim expires", async () => {
    state.configValues.set(setupClaimedKey, "true");
    state.configValues.set(setupClaimProofKey, "owner-proof");
    state.configValues.set(setupClaimedAtKey, String(Date.now() - setupClaimTtlMs - 1));
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
    expect(mocks.validateBootstrapToken).toHaveBeenCalledWith("valid-token");
    expect(state.configValues.get(setupClaimProofKey)).toBe("owner-proof");
    expect(setCalls).toHaveLength(0);
  });

  it("allows reclaiming setup after the claim expires when the bootstrap token is still valid", async () => {
    const claimProof = "22222222-2222-2222-2222-222222222222";
    const randomUuidSpy = vi.spyOn(crypto, "randomUUID").mockReturnValue(claimProof);
    try {
      state.configValues.set(setupClaimedKey, "true");
      state.configValues.set(setupClaimProofKey, "owner-proof");
      const staleClaimedAt = Date.now() - setupClaimTtlMs - 1;
      state.configValues.set(setupClaimedAtKey, String(staleClaimedAt));
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

      expect(result).toEqual({ success: true });
      expect(mocks.validateBootstrapToken).toHaveBeenCalledWith("valid-token");
      expect(state.configValues.get(setupClaimProofKey)).toBe(claimProof);
      expect(Number(state.configValues.get(setupClaimedAtKey))).toBeGreaterThan(staleClaimedAt);
      expect(setCalls).toContainEqual(
        expect.objectContaining({
          name: setupClaimCookie,
          value: claimProof,
        }),
      );
    } finally {
      randomUuidSpy.mockRestore();
    }
  });

  it("allows recovery after admin creation when setup is interrupted", async () => {
    state.configValues.set(setupClaimedKey, "true");
    state.configValues.set(setupClaimProofKey, "owner-proof");
    state.configValues.set(setupClaimedAtKey, String(Date.now()));

    const { actions } = await import("./+page.server");
    const createAdmin = actions.createAdmin;
    const claimInstance = actions.claimInstance;
    const configureOrigin = actions.configureOrigin;
    if (!createAdmin || !claimInstance || !configureOrigin) {
      throw new Error("required setup actions are undefined");
    }

    const { cookies: ownerCookies } = createCookies({ [setupClaimCookie]: "owner-proof" });
    const createAdminBody = new FormData();
    createAdminBody.set("username", "admin");
    createAdminBody.set("password", "passwordpassword");
    createAdminBody.set("confirmPassword", "passwordpassword");
    const createAdminRequest = new Request("http://localhost/setup", {
      method: "POST",
      body: createAdminBody,
    });

    const createAdminResult = await createAdmin({
      request: createAdminRequest,
      cookies: ownerCookies,
    } as unknown as Parameters<typeof createAdmin>[0]);
    expect(createAdminResult).toEqual({ success: true });
    expect(state.configValues.get(setupCompletedKey)).toBe("false");
    state.configValues.set(setupClaimedAtKey, String(Date.now() - setupClaimTtlMs - 1));

    const recoveryClaimProof = "33333333-3333-3333-3333-333333333333";
    const randomUuidSpy = vi.spyOn(crypto, "randomUUID").mockReturnValue(recoveryClaimProof);
    try {
      const { cookies: recoveredCookies } = createCookies();

      const claimBody = new FormData();
      claimBody.set("token", "valid-token");
      const claimRequest = new Request("http://localhost/setup", {
        method: "POST",
        body: claimBody,
      });
      const claimResult = await claimInstance({
        request: claimRequest,
        getClientAddress: () => "127.0.0.1",
        cookies: recoveredCookies,
      } as unknown as Parameters<typeof claimInstance>[0]);
      expect(claimResult).toEqual({ success: true });
      expect(state.configValues.get(setupClaimProofKey)).toBe(recoveryClaimProof);

      const configureOriginBody = new FormData();
      configureOriginBody.set("allowedOrigins", "http://localhost:3000");
      const configureOriginRequest = new Request("http://localhost/setup", {
        method: "POST",
        body: configureOriginBody,
      });
      const configureOriginResult = await configureOrigin({
        request: configureOriginRequest,
        cookies: recoveredCookies,
      } as unknown as Parameters<typeof configureOrigin>[0]);
      expect(configureOriginResult).toEqual({ success: true });
    } finally {
      randomUuidSpy.mockRestore();
    }
  });

  it("keeps an active installer claim valid across setup steps by renewing ownership TTL", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    try {
      const firstActionAt = 1_700_000_000_000;
      const initialClaimedAt = firstActionAt - setupClaimTtlMs + 1_000;

      state.configValues.set(setupClaimedKey, "true");
      state.configValues.set(setupClaimProofKey, "owner-proof");
      state.configValues.set(setupClaimedAtKey, String(initialClaimedAt));
      const { cookies } = createCookies({ [setupClaimCookie]: "owner-proof" });

      const { actions } = await import("./+page.server");
      const createAdmin = actions.createAdmin;
      const configureOrigin = actions.configureOrigin;
      if (!createAdmin || !configureOrigin) {
        throw new Error("required setup actions are undefined");
      }

      const createAdminBody = new FormData();
      createAdminBody.set("username", "admin");
      createAdminBody.set("password", "passwordpassword");
      createAdminBody.set("confirmPassword", "passwordpassword");
      const createAdminRequest = new Request("http://localhost/setup", {
        method: "POST",
        body: createAdminBody,
      });

      nowSpy.mockReturnValue(firstActionAt);
      const createAdminResult = await createAdmin({
        request: createAdminRequest,
        cookies,
      } as unknown as Parameters<typeof createAdmin>[0]);
      expect(createAdminResult).toEqual({ success: true });

      const secondActionAt = firstActionAt + 2_000;
      const configureOriginBody = new FormData();
      configureOriginBody.set("allowedOrigins", "http://localhost:3000");
      const configureOriginRequest = new Request("http://localhost/setup", {
        method: "POST",
        body: configureOriginBody,
      });

      nowSpy.mockReturnValue(secondActionAt);
      const configureOriginResult = await configureOrigin({
        request: configureOriginRequest,
        cookies,
      } as unknown as Parameters<typeof configureOrigin>[0]);
      expect(configureOriginResult).toEqual({ success: true });

      expect(Number(state.configValues.get(setupClaimedAtKey))).toBe(secondActionAt);
    } finally {
      nowSpy.mockRestore();
    }
  });
});

describe("createAdmin", () => {
  beforeEach(() => {
    resetStateAndMocks();
    state.configValues.set(setupClaimedKey, "true");
    state.configValues.set(setupClaimProofKey, "proof-123");
    state.configValues.set(setupClaimedAtKey, String(Date.now()));
  });

  it("persists the admin account and stores username in config", async () => {
    const staleClaimedAt = Date.now() - 1_000;
    state.configValues.set(setupClaimedAtKey, String(staleClaimedAt));
    const { cookies, setCalls } = createCookies({ [setupClaimCookie]: "proof-123" });
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

    expect(result).toEqual({ success: true });
    expect(mocks.hashAdminPassword).toHaveBeenCalledWith("passwordpassword");
    expect(mocks.createAdmin).toHaveBeenCalledWith("admin", "hashed-password");
    expect(state.configValues.get("admin_username")).toBe("admin");
    expect(state.configValues.get(setupCompletedKey)).toBe("false");
    expect(Number(state.configValues.get(setupClaimedAtKey))).toBeGreaterThan(staleClaimedAt);
    expect(setCalls).toContainEqual(
      expect.objectContaining({
        name: setupClaimCookie,
        value: "proof-123",
      }),
    );
  });

  it("returns error when admin account creation fails", async () => {
    mocks.createAdmin.mockImplementation(() => {
      throw new Error("duplicate");
    });
    const { cookies } = createCookies({ [setupClaimCookie]: "proof-123" });
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
      status: 400,
      data: { error: "Admin account could not be created", field: "username" },
    });
  });
});

describe("configureOrigin", () => {
  beforeEach(() => {
    resetStateAndMocks();
    state.configValues.set(setupClaimedKey, "true");
    state.configValues.set(setupClaimProofKey, "proof-123");
    state.configValues.set(setupClaimedAtKey, String(Date.now()));
  });

  it("rejects origin input that normalizes to an empty list", async () => {
    const { cookies } = createCookies({ [setupClaimCookie]: "proof-123" });
    const body = new FormData();
    body.set("allowedOrigins", "   ,   ");

    const request = new Request("http://localhost/setup", { method: "POST", body });

    const { actions } = await import("./+page.server");
    const configureOrigin = actions.configureOrigin;
    if (!configureOrigin) {
      throw new Error("configureOrigin action is undefined");
    }

    const result = await configureOrigin({
      request,
      cookies,
    } as unknown as Parameters<typeof configureOrigin>[0]);

    expect(result).toMatchObject({
      status: 400,
      data: { error: "At least one origin is required" },
    });
    expect(state.configValues.get("allowed_origins")).toBeUndefined();
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
    state.configValues.set("admin_username", "admin");
    mocks.adminExists.mockReturnValue(true);

    const { cookies } = createCookies({ [setupClaimCookie]: "proof-123" });
    const body = new FormData();
    body.set("defaultGroupId", "10");
    body.set("defaultProfileId", "20");
    body.set("syncInterval", "15");
    body.set("defaultProvisioningMode", "automatic");

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
    expect(mocks.clearBootstrapToken).not.toHaveBeenCalled();
  });

  it("clears the bootstrap token after setup completes", async () => {
    for (const [key, value] of Object.entries(setupPrerequisiteConfig)) {
      state.configValues.set(key, value);
    }
    state.configValues.set("admin_username", "admin");
    mocks.adminExists.mockReturnValue(true);

    const { cookies, setCalls } = createCookies({ [setupClaimCookie]: "proof-123" });
    const body = new FormData();
    body.set("defaultGroupId", "10");
    body.set("defaultProfileId", "20");
    body.set("syncInterval", "15");
    body.set("defaultProvisioningMode", "automatic");

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
    expect(mocks.hashAdminPassword).not.toHaveBeenCalled();
    expect(mocks.createAdmin).not.toHaveBeenCalled();
    expect(mocks.createSession).toHaveBeenCalledWith("admin", "admin", 3600);
    expect(mocks.appendAuditLog).toHaveBeenCalledOnce();
    expect(state.configValues.get(setupCompletedKey)).toBe("true");
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

  it("uses configured origin when ORIGIN is a stale loopback (avoids Host header influence)", async () => {
    state.env.ORIGIN = "http://localhost:3000";
    const { cookies } = createCookies({ [setupClaimCookie]: "proof-123" });

    const body = new FormData();
    body.set("plexMode", "oauth_initiate");
    const request = new Request("http://127.0.0.1:5173/setup", { method: "POST", body });

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
      url: new URL("http://127.0.0.1:5173/setup"),
      cookies,
    } as unknown as Parameters<typeof configurePlex>[0]);

    expect(oauth.initiateOAuth).toHaveBeenCalledWith("http://localhost:3000/setup");
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

  it("recovers from a transient Plex server validation failure via built-in retry", async () => {
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

    const result = await configurePlex({
      request,
      url: new URL("http://localhost/setup"),
      cookies,
    } as unknown as Parameters<typeof configurePlex>[0]);

    expect(result).toMatchObject({
      success: true,
      friendlyName: "Plex",
      machineIdentifier: "mid",
      version: "1.0",
    });
    expect(oauth.completeOAuth).toHaveBeenCalledOnce();
    expect(plexClient.validateServerToken).toHaveBeenCalledTimes(2);
  });
});

describe("configurePlex retry behavior", () => {
  beforeEach(async () => {
    resetStateAndMocks();
    state.configValues.set(setupClaimedKey, "true");
    state.configValues.set(setupClaimProofKey, "proof-123");
    state.configValues.set(setupClaimedAtKey, String(Date.now()));
    const plexClient = await import("$lib/plex/client");
    vi.mocked(plexClient.validateServerToken).mockReset();
  });

  it("succeeds on first attempt without retry", async () => {
    const { cookies } = createCookies({ [setupClaimCookie]: "proof-123" });
    const plexClient = await import("$lib/plex/client");
    vi.mocked(plexClient.validateServerToken).mockResolvedValueOnce({
      friendlyName: "Plex",
      machineIdentifier: "mid",
      version: "1.0",
    });

    const body = new FormData();
    body.set("plexMode", "token");
    body.set("plexServerUrl", "http://plex.local");
    body.set("plexToken", "test-token");
    const request = new Request("http://localhost/setup", { method: "POST", body });

    const { actions } = await import("./+page.server");
    const configurePlex = actions.configurePlex;
    if (!configurePlex) throw new Error("configurePlex action is undefined");

    const result = await configurePlex({
      request,
      url: new URL("http://localhost/setup"),
      cookies,
    } as unknown as Parameters<typeof configurePlex>[0]);

    expect(result).toMatchObject({ success: true, friendlyName: "Plex" });
    expect(plexClient.validateServerToken).toHaveBeenCalledOnce();
  });

  it("retries transient errors and succeeds", async () => {
    const { cookies } = createCookies({ [setupClaimCookie]: "proof-123" });
    const plexClient = await import("$lib/plex/client");
    const plexTypes = await import("$lib/plex/types");
    vi.mocked(plexClient.validateServerToken)
      .mockRejectedValueOnce(new plexTypes.PlexConnectionError("conn fail 1"))
      .mockRejectedValueOnce(new plexTypes.PlexConnectionError("conn fail 2"))
      .mockResolvedValueOnce({
        friendlyName: "Plex",
        machineIdentifier: "mid",
        version: "1.0",
      });

    const body = new FormData();
    body.set("plexMode", "token");
    body.set("plexServerUrl", "http://plex.local");
    body.set("plexToken", "test-token");
    const request = new Request("http://localhost/setup", { method: "POST", body });

    const { actions } = await import("./+page.server");
    const configurePlex = actions.configurePlex;
    if (!configurePlex) throw new Error("configurePlex action is undefined");

    const result = await configurePlex({
      request,
      url: new URL("http://localhost/setup"),
      cookies,
    } as unknown as Parameters<typeof configurePlex>[0]);

    expect(result).toMatchObject({ success: true });
    expect(plexClient.validateServerToken).toHaveBeenCalledTimes(3);
  });

  it("fails after exhausting all retry attempts", async () => {
    const { cookies } = createCookies({ [setupClaimCookie]: "proof-123" });
    const plexClient = await import("$lib/plex/client");
    const plexTypes = await import("$lib/plex/types");
    vi.mocked(plexClient.validateServerToken).mockRejectedValue(
      new plexTypes.PlexConnectionError("conn fail"),
    );

    const body = new FormData();
    body.set("plexMode", "token");
    body.set("plexServerUrl", "http://plex.local");
    body.set("plexToken", "test-token");
    const request = new Request("http://localhost/setup", { method: "POST", body });

    const { actions } = await import("./+page.server");
    const configurePlex = actions.configurePlex;
    if (!configurePlex) throw new Error("configurePlex action is undefined");

    const result = await configurePlex({
      request,
      url: new URL("http://localhost/setup"),
      cookies,
    } as unknown as Parameters<typeof configurePlex>[0]);

    expect(result).toMatchObject({
      status: 400,
      data: { error: expect.stringContaining("multiple attempts") },
    });
    expect(plexClient.validateServerToken).toHaveBeenCalledTimes(5);
  });

  it("does not retry auth errors", async () => {
    const { cookies } = createCookies({ [setupClaimCookie]: "proof-123" });
    const plexClient = await import("$lib/plex/client");
    const plexTypes = await import("$lib/plex/types");
    vi.mocked(plexClient.validateServerToken).mockRejectedValueOnce(
      new plexTypes.PlexAuthError("invalid token"),
    );

    const body = new FormData();
    body.set("plexMode", "token");
    body.set("plexServerUrl", "http://plex.local");
    body.set("plexToken", "test-token");
    const request = new Request("http://localhost/setup", { method: "POST", body });

    const { actions } = await import("./+page.server");
    const configurePlex = actions.configurePlex;
    if (!configurePlex) throw new Error("configurePlex action is undefined");

    const result = await configurePlex({
      request,
      url: new URL("http://localhost/setup"),
      cookies,
    } as unknown as Parameters<typeof configurePlex>[0]);

    expect(result).toMatchObject({
      status: 400,
      data: { error: expect.stringContaining("Invalid") },
    });
    expect(plexClient.validateServerToken).toHaveBeenCalledOnce();
  });
});

describe("configureDispatcharr retry behavior", () => {
  beforeEach(async () => {
    resetStateAndMocks();
    state.configValues.set(setupClaimedKey, "true");
    state.configValues.set(setupClaimProofKey, "proof-123");
    state.configValues.set(setupClaimedAtKey, String(Date.now()));
    const healthModule = await import("$lib/dispatcharr/endpoints/health");
    vi.mocked(healthModule.createHealthEndpoints).mockReset();
  });

  it("succeeds on first attempt without retry", async () => {
    const { cookies } = createCookies({ [setupClaimCookie]: "proof-123" });
    const healthModule = await import("$lib/dispatcharr/endpoints/health");
    const mockCheckHealth = vi.fn().mockResolvedValueOnce({
      ok: true,
      data: { reachable: true, authValid: true },
    });
    vi.mocked(healthModule.createHealthEndpoints).mockReturnValue({
      checkHealth: mockCheckHealth,
    } as unknown as ReturnType<typeof healthModule.createHealthEndpoints>);

    const body = new FormData();
    body.set("dispatcharrUrl", "http://dispatcharr.local");
    body.set("dispatcharrApiKey", "test-key");
    const request = new Request("http://localhost/setup", { method: "POST", body });

    const { actions } = await import("./+page.server");
    const configureDispatcharr = actions.configureDispatcharr;
    if (!configureDispatcharr) throw new Error("configureDispatcharr action is undefined");

    const result = await configureDispatcharr({
      request,
      cookies,
    } as unknown as Parameters<typeof configureDispatcharr>[0]);

    expect(result).toMatchObject({ success: true });
    expect(mockCheckHealth).toHaveBeenCalledOnce();
  });

  it("retries when server is unreachable and succeeds", async () => {
    const { cookies } = createCookies({ [setupClaimCookie]: "proof-123" });
    const healthModule = await import("$lib/dispatcharr/endpoints/health");
    const mockCheckHealth = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: { reachable: false, authValid: false } })
      .mockResolvedValueOnce({ ok: true, data: { reachable: false, authValid: false } })
      .mockResolvedValueOnce({ ok: true, data: { reachable: true, authValid: true } });
    vi.mocked(healthModule.createHealthEndpoints).mockReturnValue({
      checkHealth: mockCheckHealth,
    } as unknown as ReturnType<typeof healthModule.createHealthEndpoints>);

    const body = new FormData();
    body.set("dispatcharrUrl", "http://dispatcharr.local");
    body.set("dispatcharrApiKey", "test-key");
    const request = new Request("http://localhost/setup", { method: "POST", body });

    const { actions } = await import("./+page.server");
    const configureDispatcharr = actions.configureDispatcharr;
    if (!configureDispatcharr) throw new Error("configureDispatcharr action is undefined");

    const result = await configureDispatcharr({
      request,
      cookies,
    } as unknown as Parameters<typeof configureDispatcharr>[0]);

    expect(result).toMatchObject({ success: true });
    expect(mockCheckHealth).toHaveBeenCalledTimes(3);
  });

  it("fails after exhausting all retry attempts", async () => {
    const { cookies } = createCookies({ [setupClaimCookie]: "proof-123" });
    const healthModule = await import("$lib/dispatcharr/endpoints/health");
    const mockCheckHealth = vi.fn().mockResolvedValue({
      ok: true,
      data: { reachable: false, authValid: false },
    });
    vi.mocked(healthModule.createHealthEndpoints).mockReturnValue({
      checkHealth: mockCheckHealth,
    } as unknown as ReturnType<typeof healthModule.createHealthEndpoints>);

    const body = new FormData();
    body.set("dispatcharrUrl", "http://dispatcharr.local");
    body.set("dispatcharrApiKey", "test-key");
    const request = new Request("http://localhost/setup", { method: "POST", body });

    const { actions } = await import("./+page.server");
    const configureDispatcharr = actions.configureDispatcharr;
    if (!configureDispatcharr) throw new Error("configureDispatcharr action is undefined");

    const result = await configureDispatcharr({
      request,
      cookies,
    } as unknown as Parameters<typeof configureDispatcharr>[0]);

    expect(result).toMatchObject({
      status: 400,
      data: { error: expect.stringContaining("multiple attempts") },
    });
    expect(mockCheckHealth).toHaveBeenCalledTimes(5);
  });

  it("does not retry auth failures", async () => {
    const { cookies } = createCookies({ [setupClaimCookie]: "proof-123" });
    const healthModule = await import("$lib/dispatcharr/endpoints/health");
    const mockCheckHealth = vi.fn().mockResolvedValueOnce({
      ok: true,
      data: { reachable: true, authValid: false },
    });
    vi.mocked(healthModule.createHealthEndpoints).mockReturnValue({
      checkHealth: mockCheckHealth,
    } as unknown as ReturnType<typeof healthModule.createHealthEndpoints>);

    const body = new FormData();
    body.set("dispatcharrUrl", "http://dispatcharr.local");
    body.set("dispatcharrApiKey", "test-key");
    const request = new Request("http://localhost/setup", { method: "POST", body });

    const { actions } = await import("./+page.server");
    const configureDispatcharr = actions.configureDispatcharr;
    if (!configureDispatcharr) throw new Error("configureDispatcharr action is undefined");

    const result = await configureDispatcharr({
      request,
      cookies,
    } as unknown as Parameters<typeof configureDispatcharr>[0]);

    expect(result).toMatchObject({
      status: 400,
      data: { error: expect.stringContaining("API key is invalid") },
    });
    expect(mockCheckHealth).toHaveBeenCalledOnce();
  });
});
