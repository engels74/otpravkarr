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
  isSetupComplete: vi.fn(async () => false),
  hashAdminPassword: vi.fn(async () => "hashed-password"),
  verifyAdminPassword: vi.fn(async () => true),
  createAdmin: vi.fn(),
  adminExists: vi.fn(() => false),
  getAdminByUsername: vi.fn(
    (_: string) =>
      null as null | {
        id: number;
        username: string;
        password_hash: string;
      },
  ),
  appendAuditLog: vi.fn(),
  createSession: vi.fn(() => "session-id"),
  deleteSession: vi.fn((_id: string) => {}),
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
  verifyAdminPassword: mocks.verifyAdminPassword,
}));

vi.mock("$lib/db/repositories/admin", () => ({
  createAdmin: mocks.createAdmin,
  adminExists: mocks.adminExists,
  getAdminByUsername: mocks.getAdminByUsername,
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
  deleteSession: mocks.deleteSession,
}));

vi.mock("$lib/db/types", () => ({
  AuditAction: {
    SETUP_COMPLETED: "SETUP_COMPLETED",
    SETUP_RECOVERY_LOGIN: "setup.recovery_login",
    CONFIG_CHANGED: "config.changed",
  },
}));

vi.mock("$lib/dispatcharr/client", () => ({
  DispatcharrClient: vi.fn(),
}));

vi.mock("$lib/dispatcharr/endpoints/channel-groups", () => ({
  listChannelGroups: vi.fn(async () => ({ ok: true, data: [] })),
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
  discoverServers: vi.fn(async () => []),
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
  removePendingOAuth: vi.fn(),
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
  isSetupComplete: mocks.isSetupComplete,
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
  dispatcharr_url: "https://dispatcharr.local",
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
  mocks.isSetupComplete.mockClear().mockResolvedValue(false);
  mocks.hashAdminPassword.mockClear();
  mocks.verifyAdminPassword.mockClear().mockResolvedValue(true);
  mocks.createAdmin.mockClear();
  mocks.adminExists.mockClear().mockReturnValue(false);
  mocks.getAdminByUsername.mockClear().mockReturnValue(null);
  mocks.appendAuditLog.mockClear();
  mocks.createSession.mockClear();
  mocks.deleteSession.mockClear();
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
    });
    expect(result).not.toHaveProperty("tokenFromUrl");
    expect(result).not.toHaveProperty("tokenProvided");
    expect(mocks.requireSetupIncomplete).toHaveBeenCalledOnce();
  });

  it("surfaces claimHeldElsewhere + retry time when the cookie is lost pre-admin (ISSUE-004)", async () => {
    const claimedAt = Date.now();
    state.configValues.set(setupClaimedKey, "true");
    state.configValues.set(setupClaimProofKey, "proof-123");
    state.configValues.set(setupClaimedAtKey, String(claimedAt));
    // No claim cookie in this browser, and no admin exists yet → stranded.
    const { cookies } = createCookies();

    const { load } = await import("./+page.server");
    const result = await load({
      url: new URL("http://localhost/setup"),
      cookies,
    } as unknown as Parameters<typeof load>[0]);

    expect(result).toMatchObject({
      claimActive: false,
      adminPresent: false,
      recoveryAvailable: false,
      claimHeldElsewhere: true,
    });
    expect(result.claimRetryAt).toBe(new Date(claimedAt + setupClaimTtlMs).toISOString());
  });

  it("does not flag claimHeldElsewhere when setup_claim_proof is missing (re-claim not actually blocked)", async () => {
    state.configValues.set(setupClaimedKey, "true");
    // Timestamp present + within TTL, but the proof is absent. The real re-claim
    // gate (getActiveSetupClaimProof) returns null here, so claimInstance would
    // NOT block — guidance must match and not falsely strand the user.
    state.configValues.set(setupClaimedAtKey, String(Date.now()));
    const { cookies } = createCookies(); // no cookie, no admin → would-be stranded

    const { load } = await import("./+page.server");
    const result = await load({
      url: new URL("http://localhost/setup"),
      cookies,
    } as unknown as Parameters<typeof load>[0]);

    expect(result).toMatchObject({
      claimActive: false,
      adminPresent: false,
      recoveryAvailable: false,
      claimHeldElsewhere: false,
      claimRetryAt: null,
    });
  });

  it("does not flag claimHeldElsewhere once an admin exists (recovery is offered instead)", async () => {
    mocks.adminExists.mockReturnValue(true);
    state.configValues.set(setupClaimedKey, "true");
    state.configValues.set(setupClaimProofKey, "proof-123");
    state.configValues.set(setupClaimedAtKey, String(Date.now()));
    const { cookies } = createCookies(); // cookie lost

    const { load } = await import("./+page.server");
    const result = await load({
      url: new URL("http://localhost/setup"),
      cookies,
    } as unknown as Parameters<typeof load>[0]);

    expect(result).toMatchObject({
      claimActive: false,
      adminPresent: true,
      recoveryAvailable: true,
      claimHeldElsewhere: false,
      claimRetryAt: null,
    });
  });

  it("does not flag claimHeldElsewhere once the claim TTL has lapsed (re-claim allowed)", async () => {
    state.configValues.set(setupClaimedKey, "true");
    state.configValues.set(setupClaimProofKey, "proof-123");
    state.configValues.set(setupClaimedAtKey, String(Date.now() - setupClaimTtlMs - 1));
    const { cookies } = createCookies(); // cookie lost

    const { load } = await import("./+page.server");
    const result = await load({
      url: new URL("http://localhost/setup"),
      cookies,
    } as unknown as Parameters<typeof load>[0]);

    expect(result).toMatchObject({
      claimActive: false,
      claimHeldElsewhere: false,
      claimRetryAt: null,
    });
  });

  it("does not throw when setup_claimed_at is corrupted out of Date range (returns null)", async () => {
    state.configValues.set(setupClaimedKey, "true");
    state.configValues.set(setupClaimProofKey, "proof-123");
    // Finite but out-of-range: expiry exceeds the max JS Date (8.64e15 ms), so
    // new Date(expiry).toISOString() would throw RangeError and 500 the page.
    state.configValues.set(setupClaimedAtKey, "8640000000000001");
    const { cookies } = createCookies(); // cookie lost, no admin yet → stranded

    const { load } = await import("./+page.server");
    const result = await load({
      url: new URL("http://localhost/setup"),
      cookies,
    } as unknown as Parameters<typeof load>[0]);

    expect(result).toMatchObject({
      claimActive: false,
      claimHeldElsewhere: false,
      claimRetryAt: null,
    });
  });

  it("treats a future-dated setup_claimed_at as untrusted on load (not claimHeldElsewhere)", async () => {
    state.configValues.set(setupClaimedKey, "true");
    state.configValues.set(setupClaimProofKey, "proof-123");
    // Future timestamp (clock skew/tampering): every write site stores
    // String(Date.now()), so a value ahead of now is untrusted. Honoring it would
    // push the reported expiry well past the 10-min TTL and strand the user, so the
    // guidance must report no active claim instead of a far-future claimRetryAt.
    state.configValues.set(setupClaimedAtKey, String(Date.now() + 86_400_000));
    const { cookies } = createCookies(); // cookie lost, no admin yet → would-be stranded

    const { load } = await import("./+page.server");
    const result = await load({
      url: new URL("http://localhost/setup"),
      cookies,
    } as unknown as Parameters<typeof load>[0]);

    expect(result).toMatchObject({
      claimActive: false,
      claimHeldElsewhere: false,
      claimRetryAt: null,
    });
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

    const groups = await import("$lib/dispatcharr/endpoints/channel-groups");
    const profiles = await import("$lib/dispatcharr/endpoints/profiles");
    vi.mocked(groups.listChannelGroups).mockResolvedValueOnce({
      ok: true,
      data: [{ id: 10, name: "Group 10", channel_count: 3 }],
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

    const groups = await import("$lib/dispatcharr/endpoints/channel-groups");
    const profiles = await import("$lib/dispatcharr/endpoints/profiles");
    vi.mocked(groups.listChannelGroups).mockResolvedValueOnce({
      ok: true,
      data: [{ id: 30, name: "Group 30", channel_count: 5 }],
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
    });
  });

  it("ignores bootstrap tokens supplied in the query string", async () => {
    const { cookies } = createCookies();

    const { load } = await import("./+page.server");
    const result = await load({
      url: new URL("http://localhost/setup?token=abcd-1234-efgh"),
      cookies,
    } as unknown as Parameters<typeof load>[0]);

    expect(result).toMatchObject({
      claimActive: false,
      resumePhase: 1,
    });
    expect(result).not.toHaveProperty("tokenFromUrl");
    expect(result).not.toHaveProperty("tokenProvided");
  });

  it("does not load Dispatcharr groups/profiles when claim is not active", async () => {
    mocks.adminExists.mockReturnValue(true);
    state.configValues.set(setupClaimedKey, "true");
    state.configValues.set(setupClaimProofKey, "owner-proof");
    state.configValues.set(setupClaimedAtKey, String(Date.now()));
    for (const [key, value] of Object.entries(setupPrerequisiteConfig)) {
      state.configValues.set(key, value);
    }
    // No matching claim cookie — request is unclaimed
    const { cookies } = createCookies();

    const groups = await import("$lib/dispatcharr/endpoints/channel-groups");
    const profiles = await import("$lib/dispatcharr/endpoints/profiles");
    vi.mocked(groups.listChannelGroups).mockClear();
    vi.mocked(profiles.listProfiles).mockClear();

    const { load } = await import("./+page.server");
    const result = await load({
      url: new URL("http://localhost/setup"),
      cookies,
    } as unknown as Parameters<typeof load>[0]);

    expect(result).toMatchObject({
      claimActive: false,
      resumePhase: 5,
      dispatcharrGroups: [],
      dispatcharrProfiles: [],
    });
    // Dispatcharr client must not be consulted when the requester has not claimed setup
    expect(groups.listChannelGroups).not.toHaveBeenCalled();
    expect(profiles.listProfiles).not.toHaveBeenCalled();
  });

  it("loads Dispatcharr groups/profiles when claim is active at phase 5", async () => {
    mocks.adminExists.mockReturnValue(true);
    state.configValues.set(setupClaimedKey, "true");
    state.configValues.set(setupClaimProofKey, "proof-123");
    state.configValues.set(setupClaimedAtKey, String(Date.now()));
    for (const [key, value] of Object.entries(setupPrerequisiteConfig)) {
      state.configValues.set(key, value);
    }
    const { cookies } = createCookies({ [setupClaimCookie]: "proof-123" });

    const groups = await import("$lib/dispatcharr/endpoints/channel-groups");
    const profiles = await import("$lib/dispatcharr/endpoints/profiles");
    vi.mocked(groups.listChannelGroups).mockResolvedValueOnce({
      ok: true,
      data: [{ id: 50, name: "Group 50", channel_count: 7 }],
    });
    vi.mocked(profiles.listProfiles).mockResolvedValueOnce({
      ok: true,
      data: [{ id: 60, name: "Profile 60" }],
    });

    const { load } = await import("./+page.server");
    const result = await load({
      url: new URL("http://localhost/setup"),
      cookies,
    } as unknown as Parameters<typeof load>[0]);

    expect(result).toMatchObject({
      claimActive: true,
      resumePhase: 5,
      dispatcharrGroups: [{ id: 50, name: "Group 50" }],
      dispatcharrProfiles: [{ id: 60, name: "Profile 60" }],
    });
    expect(groups.listChannelGroups).toHaveBeenCalled();
    expect(profiles.listProfiles).toHaveBeenCalled();
  });

  // ISSUE-002: the defaults-step group picker must be sourced from the
  // SUBSCRIBABLE channel-groups endpoint (/api/channels/groups/), not Django
  // permission groups, and must exclude quarantine groups — matching Settings.
  it("sources the defaults group picker from channel groups and excludes quarantine groups", async () => {
    mocks.adminExists.mockReturnValue(true);
    state.configValues.set(setupClaimedKey, "true");
    state.configValues.set(setupClaimProofKey, "proof-123");
    state.configValues.set(setupClaimedAtKey, String(Date.now()));
    for (const [key, value] of Object.entries(setupPrerequisiteConfig)) {
      state.configValues.set(key, value);
    }
    const { cookies } = createCookies({ [setupClaimCookie]: "proof-123" });

    const groups = await import("$lib/dispatcharr/endpoints/channel-groups");
    vi.mocked(groups.listChannelGroups).mockResolvedValueOnce({
      ok: true,
      data: [
        { id: 100, name: "Sports", channel_count: 12 },
        { id: 101, name: "News", channel_count: 8 },
        { id: 102, name: "Graveyard", channel_count: 99 },
      ],
    });

    const { load } = await import("./+page.server");
    const result = (await load({
      url: new URL("http://localhost/setup"),
      cookies,
    } as unknown as Parameters<typeof load>[0])) as {
      dispatcharrGroups: { id: number; name: string }[];
    };

    expect(groups.listChannelGroups).toHaveBeenCalled();
    expect(result.dispatcharrGroups).toEqual([
      { id: 100, name: "Sports" },
      { id: 101, name: "News" },
    ]);
    // Quarantine group must not be offered.
    expect(result.dispatcharrGroups.some((g) => g.name === "Graveyard")).toBe(false);
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

  it("does not honor a future-dated claim and lets a valid token re-claim (not 409)", async () => {
    const claimProof = "44444444-4444-4444-4444-444444444444";
    const randomUuidSpy = vi.spyOn(crypto, "randomUUID").mockReturnValue(claimProof);
    try {
      state.configValues.set(setupClaimedKey, "true");
      state.configValues.set(setupClaimProofKey, "owner-proof");
      // Future timestamp (clock skew/tampering). The proof gate must reject it so
      // claimInstance does NOT block with 409 for the inflated now..future+TTL
      // window — proving the gate, not just the guidance, ignores tampered claims.
      state.configValues.set(setupClaimedAtKey, String(Date.now() + 86_400_000));
      const { cookies, setCalls } = createCookies(); // no matching claim cookie

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
      expect(state.configValues.get(setupClaimProofKey)).toBe(claimProof);
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
      getClientAddress: () => "127.0.0.1",
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
        getClientAddress: () => "127.0.0.1",
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
        getClientAddress: () => "127.0.0.1",
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
        getClientAddress: () => "127.0.0.1",
      } as unknown as Parameters<typeof configureOrigin>[0]);
      expect(configureOriginResult).toEqual({ success: true });

      expect(Number(state.configValues.get(setupClaimedAtKey))).toBe(secondActionAt);
    } finally {
      nowSpy.mockRestore();
    }
  });
});

describe("oauthCallback query parameter", () => {
  beforeEach(() => {
    resetStateAndMocks();
  });

  it("returns oauthCallback true when URL has ?oauthCallback=1", async () => {
    const { cookies } = createCookies();

    const { load } = await import("./+page.server");
    const result = await load({
      url: new URL("http://localhost/setup?oauthCallback=1"),
      cookies,
    } as unknown as Parameters<typeof load>[0]);

    expect(result.oauthCallback).toBe(true);
  });

  it("returns oauthCallback false when param is absent", async () => {
    const { cookies } = createCookies();

    const { load } = await import("./+page.server");
    const result = await load({
      url: new URL("http://localhost/setup"),
      cookies,
    } as unknown as Parameters<typeof load>[0]);

    expect(result.oauthCallback).toBe(false);
  });

  it("returns oauthCallback false when param has wrong value", async () => {
    const { cookies } = createCookies();

    const { load } = await import("./+page.server");
    const result = await load({
      url: new URL("http://localhost/setup?oauthCallback=0"),
      cookies,
    } as unknown as Parameters<typeof load>[0]);

    expect(result.oauthCallback).toBe(false);
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
      getClientAddress: () => "127.0.0.1",
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

  it("returns 409 and does not insert a second admin when one already exists", async () => {
    mocks.adminExists.mockReturnValue(true);
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
      status: 409,
      data: {
        error: "An admin account already exists for this installation",
        field: "username",
      },
    });
    expect(mocks.createAdmin).not.toHaveBeenCalled();
    expect(mocks.hashAdminPassword).not.toHaveBeenCalled();
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
    expect(mocks.deleteSession).not.toHaveBeenCalled();
  });

  it("deletes prior session before creating a new one on setup completion", async () => {
    for (const [key, value] of Object.entries(setupPrerequisiteConfig)) {
      state.configValues.set(key, value);
    }
    state.configValues.set("admin_username", "admin");
    mocks.adminExists.mockReturnValue(true);

    const { cookies } = createCookies({
      [setupClaimCookie]: "proof-123",
      otpravkarr_session: "prior-session-id",
    });
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
    ).rejects.toMatchObject({ status: 303 });

    expect(mocks.deleteSession).toHaveBeenCalledWith("prior-session-id");
    expect(mocks.createSession).toHaveBeenCalledWith("admin", "admin", 3600);
    const deleteOrder = mocks.deleteSession.mock.invocationCallOrder[0] ?? Infinity;
    const createOrder = mocks.createSession.mock.invocationCallOrder[0] ?? -Infinity;
    expect(deleteOrder).toBeLessThan(createOrder);
  });
});

describe("configurePlex oauth initiate origin selection", () => {
  beforeEach(() => {
    resetStateAndMocks();
    state.configValues.set(setupClaimedKey, "true");
    state.configValues.set(setupClaimProofKey, "proof-123");
    state.configValues.set(setupClaimedAtKey, String(Date.now()));
  });

  it("uses request origin (not configured ORIGIN) for OAuth forward URL so postMessage succeeds", async () => {
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
    // Must use request origin so the popup callback lands on the same
    // origin as the opener, allowing the postMessage handshake to work.
    expect(oauth.initiateOAuth).toHaveBeenCalledWith("http://127.0.0.1:3000/setup?oauthCallback=1");
  });

  it("uses request origin even when ORIGIN is a different loopback", async () => {
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

    expect(oauth.initiateOAuth).toHaveBeenCalledWith("http://127.0.0.1:5173/setup?oauthCallback=1");
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

    expect(oauth.initiateOAuth).toHaveBeenCalledWith("http://127.0.0.1:3000/setup?oauthCallback=1");
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
    body.set("plexServerUrl", "http://localhost:32400");

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
      getClientAddress: () => "127.0.0.1",
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

  it("rejects non-loopback http plex server URL in oauth_complete", async () => {
    const { cookies } = createCookies({ [setupClaimCookie]: "proof-123" });
    const oauth = await import("$lib/plex/oauth");
    const plexClient = await import("$lib/plex/client");
    vi.mocked(oauth.completeOAuth).mockClear();
    vi.mocked(plexClient.validateServerToken).mockClear();

    const body = new FormData();
    body.set("plexMode", "oauth_complete");
    body.set("oauthId", "oauth-id");
    body.set("plexServerUrl", "http://external.example.com");

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
      status: 400,
      data: expect.objectContaining({
        error: expect.stringContaining("Plex server URL must use HTTPS"),
      }),
    });
    expect(oauth.completeOAuth).not.toHaveBeenCalled();
    expect(plexClient.validateServerToken).not.toHaveBeenCalled();
  });
});

describe("configurePlex oauth_discover", () => {
  beforeEach(() => {
    resetStateAndMocks();
    state.configValues.set(setupClaimedKey, "true");
    state.configValues.set(setupClaimProofKey, "proof-123");
    state.configValues.set(setupClaimedAtKey, String(Date.now()));
  });

  it("returns discovered servers on success", async () => {
    const { cookies } = createCookies({ [setupClaimCookie]: "proof-123" });
    const plexClient = await import("$lib/plex/client");

    const mockServers = [
      {
        name: "My Plex Server",
        machineId: "abc123",
        connections: [
          {
            uri: "https://192.168.1.100:32400",
            protocol: "https",
            address: "192.168.1.100",
            port: 32400,
            local: true,
            relay: false,
          },
        ],
      },
    ];
    vi.mocked(plexClient.discoverServers).mockResolvedValueOnce(mockServers);

    const body = new FormData();
    body.set("plexMode", "oauth_discover");
    body.set("oauthId", "oauth-id");
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
      success: true,
      servers: mockServers,
    });
    expect(plexClient.discoverServers).toHaveBeenCalledWith("plex-auth-token");
  });

  it("returns fail(400) when discoverServers throws PlexConnectionError", async () => {
    const { cookies } = createCookies({ [setupClaimCookie]: "proof-123" });
    const plexClient = await import("$lib/plex/client");
    const plexTypes = await import("$lib/plex/types");

    vi.mocked(plexClient.discoverServers).mockRejectedValueOnce(
      new plexTypes.PlexConnectionError("discovery failed"),
    );

    const body = new FormData();
    body.set("plexMode", "oauth_discover");
    body.set("oauthId", "oauth-id");
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
      data: { error: expect.stringContaining("Could not connect to Plex server") },
    });
  });

  it("returns fail(400) when discoverServers throws PlexAuthError", async () => {
    const { cookies } = createCookies({ [setupClaimCookie]: "proof-123" });
    const plexClient = await import("$lib/plex/client");
    const plexTypes = await import("$lib/plex/types");

    vi.mocked(plexClient.discoverServers).mockRejectedValueOnce(
      new plexTypes.PlexAuthError("invalid token"),
    );

    const body = new FormData();
    body.set("plexMode", "oauth_discover");
    body.set("oauthId", "oauth-id");
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
  });

  it("returns fail(400) for missing oauthId", async () => {
    const { cookies } = createCookies({ [setupClaimCookie]: "proof-123" });

    const body = new FormData();
    body.set("plexMode", "oauth_discover");
    // oauthId intentionally omitted
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
      data: { error: "OAuth session ID is required" },
    });
  });

  it("returns fail(400) for empty oauthId", async () => {
    const { cookies } = createCookies({ [setupClaimCookie]: "proof-123" });

    const body = new FormData();
    body.set("plexMode", "oauth_discover");
    body.set("oauthId", "   ");
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
      data: { error: "OAuth session ID is required" },
    });
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
    body.set("plexServerUrl", "http://localhost:32400");
    body.set("plexToken", "test-token");
    const request = new Request("http://localhost/setup", { method: "POST", body });

    const { actions } = await import("./+page.server");
    const configurePlex = actions.configurePlex;
    if (!configurePlex) throw new Error("configurePlex action is undefined");

    const result = await configurePlex({
      request,
      url: new URL("http://localhost/setup"),
      cookies,
      getClientAddress: () => "127.0.0.1",
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
    body.set("plexServerUrl", "http://localhost:32400");
    body.set("plexToken", "test-token");
    const request = new Request("http://localhost/setup", { method: "POST", body });

    const { actions } = await import("./+page.server");
    const configurePlex = actions.configurePlex;
    if (!configurePlex) throw new Error("configurePlex action is undefined");

    const result = await configurePlex({
      request,
      url: new URL("http://localhost/setup"),
      cookies,
      getClientAddress: () => "127.0.0.1",
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
    body.set("plexServerUrl", "http://localhost:32400");
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
      data: { error: expect.stringContaining("Could not connect to Plex server") },
    });
    expect(plexClient.validateServerToken).toHaveBeenCalledTimes(5);
  });

  it("does not retry deterministic PlexConnectionError (Bad request)", async () => {
    const { cookies } = createCookies({ [setupClaimCookie]: "proof-123" });
    const plexClient = await import("$lib/plex/client");
    const plexTypes = await import("$lib/plex/types");
    vi.mocked(plexClient.validateServerToken).mockRejectedValueOnce(
      new plexTypes.PlexConnectionError("Bad request: invalid URL format"),
    );

    const body = new FormData();
    body.set("plexMode", "token");
    body.set("plexServerUrl", "http://localhost:32400");
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
      data: { error: expect.stringContaining("Could not connect to Plex server") },
    });
    expect(plexClient.validateServerToken).toHaveBeenCalledOnce();
  });

  it("does not retry deterministic PlexConnectionError (Not found)", async () => {
    const { cookies } = createCookies({ [setupClaimCookie]: "proof-123" });
    const plexClient = await import("$lib/plex/client");
    const plexTypes = await import("$lib/plex/types");
    vi.mocked(plexClient.validateServerToken).mockRejectedValueOnce(
      new plexTypes.PlexConnectionError("Not found: no server at this address"),
    );

    const body = new FormData();
    body.set("plexMode", "token");
    body.set("plexServerUrl", "http://localhost:32400");
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
      data: { error: expect.stringContaining("Could not connect to Plex server") },
    });
    expect(plexClient.validateServerToken).toHaveBeenCalledOnce();
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
    body.set("plexServerUrl", "http://localhost:32400");
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
    body.set("dispatcharrUrl", "https://dispatcharr.local");
    body.set("dispatcharrApiKey", "test-key");
    const request = new Request("http://localhost/setup", { method: "POST", body });

    const { actions } = await import("./+page.server");
    const configureDispatcharr = actions.configureDispatcharr;
    if (!configureDispatcharr) throw new Error("configureDispatcharr action is undefined");

    const result = await configureDispatcharr({
      request,
      cookies,
      getClientAddress: () => "127.0.0.1",
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
    body.set("dispatcharrUrl", "https://dispatcharr.local");
    body.set("dispatcharrApiKey", "test-key");
    const request = new Request("http://localhost/setup", { method: "POST", body });

    const { actions } = await import("./+page.server");
    const configureDispatcharr = actions.configureDispatcharr;
    if (!configureDispatcharr) throw new Error("configureDispatcharr action is undefined");

    const result = await configureDispatcharr({
      request,
      cookies,
      getClientAddress: () => "127.0.0.1",
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
    body.set("dispatcharrUrl", "https://dispatcharr.local");
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

  it("stores external URL when provided", async () => {
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
    body.set("dispatcharrUrl", "https://dispatcharr.local");
    body.set("dispatcharrApiKey", "test-key");
    body.set("dispatcharrExternalUrl", "https://external.example.com");
    const request = new Request("http://localhost/setup", { method: "POST", body });

    const { actions } = await import("./+page.server");
    const configureDispatcharr = actions.configureDispatcharr;
    if (!configureDispatcharr) throw new Error("configureDispatcharr action is undefined");

    const result = await configureDispatcharr({
      request,
      cookies,
      getClientAddress: () => "127.0.0.1",
    } as unknown as Parameters<typeof configureDispatcharr>[0]);

    expect(result).toMatchObject({ success: true });
    expect(mocks.setConfig).toHaveBeenCalledWith(
      "dispatcharr_external_url",
      "https://external.example.com",
    );
  });

  it("stores empty string for external URL when not provided", async () => {
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
    body.set("dispatcharrUrl", "https://dispatcharr.local");
    body.set("dispatcharrApiKey", "test-key");
    const request = new Request("http://localhost/setup", { method: "POST", body });

    const { actions } = await import("./+page.server");
    const configureDispatcharr = actions.configureDispatcharr;
    if (!configureDispatcharr) throw new Error("configureDispatcharr action is undefined");

    const result = await configureDispatcharr({
      request,
      cookies,
      getClientAddress: () => "127.0.0.1",
    } as unknown as Parameters<typeof configureDispatcharr>[0]);

    expect(result).toMatchObject({ success: true });
    expect(mocks.setConfig).toHaveBeenCalledWith("dispatcharr_external_url", "");
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
    body.set("dispatcharrUrl", "https://dispatcharr.local");
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

describe("setup recovery via admin login", () => {
  beforeEach(() => {
    resetStateAndMocks();
  });

  function adminFixture() {
    return {
      id: 1,
      username: "dogfood-admin",
      password_hash: "argon2-hashed",
      created_at: "2026-01-01 00:00:00",
      updated_at: "2026-01-01 00:00:00",
    };
  }

  async function callRecover(body: FormData, cookieJar = createCookies()) {
    const request = new Request("http://localhost/setup", { method: "POST", body });
    const { actions } = await import("./+page.server");
    const recoverWithAdmin = actions.recoverWithAdmin;
    if (!recoverWithAdmin) throw new Error("recoverWithAdmin action is undefined");
    const result = await recoverWithAdmin({
      request,
      cookies: cookieJar.cookies,
      getClientAddress: () => "127.0.0.1",
    } as unknown as Parameters<typeof recoverWithAdmin>[0]);
    return { result, ...cookieJar };
  }

  it("re-issues a claim cookie when valid admin credentials are supplied", async () => {
    mocks.adminExists.mockReturnValue(true);
    mocks.getAdminByUsername.mockReturnValue(adminFixture());
    mocks.verifyAdminPassword.mockResolvedValue(true);
    const proof = "22222222-2222-2222-2222-222222222222";
    const randomUuidSpy = vi.spyOn(crypto, "randomUUID").mockReturnValue(proof);
    try {
      const body = new FormData();
      body.set("username", "dogfood-admin");
      body.set("password", "DogfoodTestPass2026XYZ");

      const { result, setCalls } = await callRecover(body);

      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          resumePhase: 2,
          dispatcharrGroups: [],
          dispatcharrProfiles: [],
        }),
      );
      expect(state.configValues.get(setupClaimedKey)).toBe("true");
      expect(state.configValues.get(setupClaimProofKey)).toBe(proof);
      expect(state.configValues.get(setupClaimedAtKey)).toBeDefined();
      const claimCookie = setCalls.find((c) => c.name === setupClaimCookie);
      expect(claimCookie).toBeDefined();
      expect(claimCookie?.value).toBe(proof);
      expect(mocks.appendAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "setup.recovery_login",
          actor: "dogfood-admin",
        }),
      );
    } finally {
      randomUuidSpy.mockRestore();
    }
  });

  it("rejects with invalid_credentials when password verification fails", async () => {
    mocks.adminExists.mockReturnValue(true);
    mocks.getAdminByUsername.mockReturnValue(adminFixture());
    mocks.verifyAdminPassword.mockResolvedValue(false);

    const body = new FormData();
    body.set("username", "dogfood-admin");
    body.set("password", "wrong-password");

    const { result } = await callRecover(body);

    expect(result).toMatchObject({
      status: 401,
      data: { error: "invalid_credentials" },
    });
    expect(mocks.appendAuditLog).not.toHaveBeenCalled();
  });

  it("rate limits per IP via the setup limiter", async () => {
    mocks.adminExists.mockReturnValue(true);
    state.limiterAllowed = false;

    const body = new FormData();
    body.set("username", "dogfood-admin");
    body.set("password", "DogfoodTestPass2026XYZ");

    const { result } = await callRecover(body);

    expect(result).toMatchObject({
      status: 429,
      data: { error: "rate_limited" },
    });
    expect(mocks.verifyAdminPassword).not.toHaveBeenCalled();
  });

  it("returns 404 when setup is already complete", async () => {
    mocks.isSetupComplete.mockResolvedValue(true);
    mocks.adminExists.mockReturnValue(true);

    const body = new FormData();
    body.set("username", "dogfood-admin");
    body.set("password", "DogfoodTestPass2026XYZ");

    const { result } = await callRecover(body);

    expect(result).toMatchObject({
      status: 404,
      data: { error: "not_found" },
    });
  });

  it("renews the claim cookie when one is already valid", async () => {
    mocks.adminExists.mockReturnValue(true);
    state.configValues.set(setupClaimedKey, "true");
    state.configValues.set(setupClaimProofKey, "existing-proof");
    state.configValues.set(setupClaimedAtKey, String(Date.now()));
    const cookieJar = createCookies({ [setupClaimCookie]: "existing-proof" });

    const body = new FormData();
    body.set("username", "dogfood-admin");
    body.set("password", "DogfoodTestPass2026XYZ");

    const { result, setCalls } = await callRecover(body, cookieJar);

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        resumePhase: 2,
        dispatcharrGroups: [],
        dispatcharrProfiles: [],
      }),
    );
    expect(mocks.verifyAdminPassword).not.toHaveBeenCalled();
    const claimCookie = setCalls.find((c) => c.name === setupClaimCookie);
    expect(claimCookie?.value).toBe("existing-proof");
  });

  it("returns 409 when no admin account exists", async () => {
    mocks.adminExists.mockReturnValue(false);

    const body = new FormData();
    body.set("username", "dogfood-admin");
    body.set("password", "DogfoodTestPass2026XYZ");

    const { result } = await callRecover(body);

    expect(result).toMatchObject({
      status: 409,
      data: { error: "no_admin" },
    });
  });
});
