// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  configValues: new Map<string, string>(),
  consumeTokenResult: true,
  limiterAllowed: true,
}));

const mocks = vi.hoisted(() => ({
  consumeBootstrapToken: vi.fn((_: string) => state.consumeTokenResult),
  getConfig: vi.fn(async (key: string) => state.configValues.get(key) ?? null),
  setConfig: vi.fn(async (key: string, value: string) => {
    state.configValues.set(key, value);
  }),
  setupLimiterCheck: vi.fn((_: string) => ({ allowed: state.limiterAllowed })),
  requireSetupIncomplete: vi.fn(),
}));

vi.mock("$lib/crypto/bootstrap", () => ({
  consumeBootstrapToken: mocks.consumeBootstrapToken,
}));

vi.mock("$lib/crypto/passwords", () => ({
  hashAdminPassword: vi.fn(async () => "hashed-password"),
}));

vi.mock("$lib/db/repositories/admin", () => ({
  createAdmin: vi.fn(),
}));

vi.mock("$lib/db/repositories/audit", () => ({
  appendAuditLog: vi.fn(),
}));

vi.mock("$lib/db/repositories/config", () => ({
  getConfig: mocks.getConfig,
  setConfig: mocks.setConfig,
}));

vi.mock("$lib/db/repositories/sessions", () => ({
  createSession: vi.fn(() => "session-id"),
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
  completeOAuth: vi.fn(),
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
const setupClaimCookie = "otpravkarr_setup_claim";

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

describe("setup claim ownership", () => {
  beforeEach(() => {
    state.configValues.clear();
    state.consumeTokenResult = true;
    state.limiterAllowed = true;

    mocks.consumeBootstrapToken.mockClear();
    mocks.getConfig.mockClear();
    mocks.setConfig.mockClear();
    mocks.setupLimiterCheck.mockClear();
    mocks.requireSetupIncomplete.mockClear();
  });

  it("marks claimActive on load when claim cookie matches stored proof", async () => {
    state.configValues.set(setupClaimedKey, "true");
    state.configValues.set(setupClaimProofKey, "proof-123");
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
    expect(setCalls).toContainEqual(
      expect.objectContaining({
        name: setupClaimCookie,
        value: claimProof,
      }),
    );

    randomUuidSpy.mockRestore();
  });

  it("allows reclaiming setup when prior claim proof cookie is missing", async () => {
    state.configValues.set(setupClaimedKey, "true");
    state.configValues.set(setupClaimProofKey, "owner-proof");
    const rotatedProof = "22222222-2222-2222-2222-222222222222";
    const randomUuidSpy = vi.spyOn(crypto, "randomUUID").mockReturnValue(rotatedProof);

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
    expect(state.configValues.get(setupClaimProofKey)).toBe(rotatedProof);
    expect(setCalls).toContainEqual(
      expect.objectContaining({
        name: setupClaimCookie,
        value: rotatedProof,
      }),
    );

    randomUuidSpy.mockRestore();
  });
});
