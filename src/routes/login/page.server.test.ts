// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminAccount } from "$lib/db/types";

const state = vi.hoisted(() => ({
  limiterAllowed: true,
  admin: {
    id: 1,
    username: "admin",
    password_hash: "hashed-password",
    created_at: "2024-01-01 00:00:00",
    updated_at: "2024-01-01 00:00:00",
  } as AdminAccount | null,
  passwordValid: true,
}));

const mocks = vi.hoisted(() => ({
  verifyAdminPassword: vi.fn(async () => state.passwordValid),
  getAdminByUsername: vi.fn((_username: string) => state.admin),
  appendAuditLog: vi.fn(),
  createSession: vi.fn(() => "session-id"),
  loginLimiterCheck: vi.fn((_address: string) => ({ allowed: state.limiterAllowed })),
}));

vi.mock("$lib/crypto/passwords", () => ({
  verifyAdminPassword: mocks.verifyAdminPassword,
}));

vi.mock("$lib/db/repositories/admin", () => ({
  getAdminByUsername: mocks.getAdminByUsername,
}));

vi.mock("$lib/db/repositories/audit", () => ({
  appendAuditLog: mocks.appendAuditLog,
}));

vi.mock("$lib/db/repositories/sessions", () => ({
  createSession: mocks.createSession,
}));

vi.mock("$lib/server/ratelimit", () => ({
  loginLimiter: {
    check: mocks.loginLimiterCheck,
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
  SESSION_COOKIE_NAME: "otpravkarr_session",
}));

function createCookies() {
  const set = vi.fn();
  return {
    cookies: {
      set,
    },
    set,
  };
}

function createRequest(values: { username?: string; password?: string }) {
  const body = new FormData();
  if (values.username !== undefined) {
    body.set("username", values.username);
  }
  if (values.password !== undefined) {
    body.set("password", values.password);
  }

  return new Request("http://localhost/login", {
    method: "POST",
    body,
  });
}

function resetStateAndMocks() {
  state.limiterAllowed = true;
  state.admin = {
    id: 1,
    username: "admin",
    password_hash: "hashed-password",
    created_at: "2024-01-01 00:00:00",
    updated_at: "2024-01-01 00:00:00",
  };
  state.passwordValid = true;

  mocks.verifyAdminPassword.mockClear();
  mocks.getAdminByUsername.mockClear();
  mocks.appendAuditLog.mockClear();
  mocks.createSession.mockClear();
  mocks.loginLimiterCheck.mockClear();
}

describe("login page server", () => {
  beforeEach(() => {
    resetStateAndMocks();
  });

  it("redirects authenticated admins to /dashboard in load", async () => {
    const { load } = await import("./+page.server");

    await expect(
      load({
        locals: {
          session: { id: "sess-1", type: "admin", userRef: "admin" },
          admin: { id: 1, username: "admin" },
        },
      } as unknown as Parameters<typeof load>[0]),
    ).rejects.toMatchObject({
      status: 303,
      location: "/dashboard",
    });
  });

  it("returns 429 when login rate limit is exceeded", async () => {
    state.limiterAllowed = false;

    const { actions } = await import("./+page.server");
    const login = actions.default;
    if (!login) {
      throw new Error("default action is undefined");
    }

    const { cookies } = createCookies();
    const result = await login({
      request: createRequest({ username: "admin", password: "password" }),
      cookies,
      getClientAddress: () => "127.0.0.1",
    } as unknown as Parameters<typeof login>[0]);

    expect(result).toMatchObject({
      status: 429,
      data: { error: "rate_limited" },
    });
    expect(mocks.getAdminByUsername).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("returns 400 when credentials are missing", async () => {
    const { actions } = await import("./+page.server");
    const login = actions.default;
    if (!login) {
      throw new Error("default action is undefined");
    }

    const { cookies } = createCookies();
    const result = await login({
      request: createRequest({ username: "", password: "" }),
      cookies,
      getClientAddress: () => "127.0.0.1",
    } as unknown as Parameters<typeof login>[0]);

    expect(result).toMatchObject({
      status: 400,
      data: { error: "missing_credentials" },
    });
    expect(mocks.getAdminByUsername).not.toHaveBeenCalled();
  });

  it("returns 401 for unknown usernames", async () => {
    state.admin = null;

    const { actions } = await import("./+page.server");
    const login = actions.default;
    if (!login) {
      throw new Error("default action is undefined");
    }

    const { cookies } = createCookies();
    const result = await login({
      request: createRequest({ username: "missing-admin", password: "password" }),
      cookies,
      getClientAddress: () => "127.0.0.1",
    } as unknown as Parameters<typeof login>[0]);

    expect(result).toMatchObject({
      status: 401,
      data: { error: "invalid_credentials" },
    });
    expect(mocks.verifyAdminPassword).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("returns 401 for invalid passwords", async () => {
    state.passwordValid = false;

    const { actions } = await import("./+page.server");
    const login = actions.default;
    if (!login) {
      throw new Error("default action is undefined");
    }

    const { cookies } = createCookies();
    const result = await login({
      request: createRequest({ username: "admin", password: "wrong-password" }),
      cookies,
      getClientAddress: () => "127.0.0.1",
    } as unknown as Parameters<typeof login>[0]);

    expect(result).toMatchObject({
      status: 401,
      data: { error: "invalid_credentials" },
    });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("creates session cookie and redirects to /dashboard on success", async () => {
    const { actions } = await import("./+page.server");
    const login = actions.default;
    if (!login) {
      throw new Error("default action is undefined");
    }

    const { cookies, set } = createCookies();
    await expect(
      login({
        request: createRequest({ username: "  admin  ", password: "valid-password" }),
        cookies,
        getClientAddress: () => "127.0.0.1",
      } as unknown as Parameters<typeof login>[0]),
    ).rejects.toMatchObject({
      status: 303,
      location: "/dashboard",
    });

    expect(mocks.loginLimiterCheck).toHaveBeenCalledWith("127.0.0.1");
    expect(mocks.getAdminByUsername).toHaveBeenCalledWith("admin");
    expect(mocks.verifyAdminPassword).toHaveBeenCalledWith("valid-password", "hashed-password");
    expect(mocks.createSession).toHaveBeenCalledWith("admin", "admin", 3600);
    expect(set).toHaveBeenCalledWith(
      "otpravkarr_session",
      "session-id",
      expect.objectContaining({
        path: "/",
        httpOnly: true,
        secure: true,
      }),
    );
    expect(mocks.appendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "admin",
        action: "admin.login",
        ipAddress: "127.0.0.1",
      }),
    );
  });
});
