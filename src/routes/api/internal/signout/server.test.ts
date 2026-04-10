// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteSession: vi.fn((_id: string) => {}),
  appendAuditLog: vi.fn(),
}));

vi.mock("$lib/db/repositories/sessions", () => ({
  deleteSession: mocks.deleteSession,
}));

vi.mock("$lib/db/repositories/audit", () => ({
  appendAuditLog: mocks.appendAuditLog,
}));

vi.mock("$lib/db/types", () => ({
  AuditAction: {
    ADMIN_LOGOUT: "admin.logout",
  },
}));

vi.mock("$lib/server/auth", () => ({
  SESSION_COOKIE_NAME: "otpravkarr_session",
}));

function createCookies(sessionId?: string) {
  const set = vi.fn();
  const deleteFn = vi.fn();
  const get = vi.fn((name: string) => {
    if (name === "otpravkarr_session") return sessionId;
    return undefined;
  });
  return { cookies: { get, set, delete: deleteFn }, set, deleteFn };
}

function resetAll() {
  mocks.deleteSession.mockClear();
  mocks.appendAuditLog.mockClear();
}

describe("signout endpoint", () => {
  beforeEach(() => {
    resetAll();
  });

  it("deletes session and redirects user session to /", async () => {
    const { POST } = await import("./+server");
    const { cookies, deleteFn } = createCookies("sess-123");

    await expect(
      POST({
        cookies,
        request: new Request("http://localhost/api/internal/signout", { method: "POST" }),
        locals: {
          session: { id: "sess-123", type: "user", userRef: "1" },
        },
        getClientAddress: () => "127.0.0.1",
      } as unknown as Parameters<typeof POST>[0]),
    ).rejects.toMatchObject({
      status: 303,
      location: "/",
    });

    expect(mocks.deleteSession).toHaveBeenCalledWith("sess-123");
    expect(deleteFn).toHaveBeenCalledWith(
      "otpravkarr_session",
      expect.objectContaining({ path: "/" }),
    );
    expect(mocks.appendAuditLog).not.toHaveBeenCalled();
  });

  it("deletes session and redirects admin session to /login", async () => {
    const { POST } = await import("./+server");
    const { cookies, deleteFn } = createCookies("sess-456");

    await expect(
      POST({
        cookies,
        request: new Request("http://localhost/api/internal/signout", { method: "POST" }),
        locals: {
          session: { id: "sess-456", type: "admin", userRef: "admin" },
          admin: { id: 1, username: "admin" },
        },
        getClientAddress: () => "10.0.0.1",
      } as unknown as Parameters<typeof POST>[0]),
    ).rejects.toMatchObject({
      status: 303,
      location: "/login",
    });

    expect(mocks.deleteSession).toHaveBeenCalledWith("sess-456");
    expect(deleteFn).toHaveBeenCalledWith(
      "otpravkarr_session",
      expect.objectContaining({ path: "/" }),
    );
  });

  it("appends audit log for admin logout", async () => {
    const { POST } = await import("./+server");
    const { cookies } = createCookies("sess-456");

    try {
      await POST({
        cookies,
        request: new Request("http://localhost/api/internal/signout", { method: "POST" }),
        locals: {
          session: { id: "sess-456", type: "admin", userRef: "admin" },
          admin: { id: 1, username: "admin" },
        },
        getClientAddress: () => "10.0.0.1",
      } as unknown as Parameters<typeof POST>[0]);
    } catch {
      // redirect expected
    }

    expect(mocks.appendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "admin",
        action: "admin.logout",
        ipAddress: "10.0.0.1",
      }),
    );
  });

  it("handles missing session cookie gracefully", async () => {
    const { POST } = await import("./+server");
    const { cookies } = createCookies(undefined);

    await expect(
      POST({
        cookies,
        request: new Request("http://localhost/api/internal/signout", { method: "POST" }),
        locals: {},
        getClientAddress: () => "127.0.0.1",
      } as unknown as Parameters<typeof POST>[0]),
    ).rejects.toMatchObject({
      status: 303,
      location: "/login",
    });

    expect(mocks.deleteSession).not.toHaveBeenCalled();
  });

  it("does not append audit log for non-admin signout", async () => {
    const { POST } = await import("./+server");
    const { cookies } = createCookies("sess-789");

    try {
      await POST({
        cookies,
        request: new Request("http://localhost/api/internal/signout", { method: "POST" }),
        locals: {
          session: { id: "sess-789", type: "user", userRef: "42" },
        },
        getClientAddress: () => "127.0.0.1",
      } as unknown as Parameters<typeof POST>[0]);
    } catch {
      // redirect expected
    }

    expect(mocks.appendAuditLog).not.toHaveBeenCalled();
  });
});
