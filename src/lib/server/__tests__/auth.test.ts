// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminAccount, Session, UserMapping } from "$lib/db/types";

// ---------------------------------------------------------------------------
// Mock state
// ---------------------------------------------------------------------------

let mockSession: Session | null = null;
let mockAdmin: AdminAccount | null = null;
let mockUser: UserMapping | null = null;
let mockAdminExists = false;

// ---------------------------------------------------------------------------
// Mock SvelteKit — redirect and error throw objects we can catch
// ---------------------------------------------------------------------------

vi.mock("@sveltejs/kit", () => ({
  redirect: (status: number, location: string) => {
    throw { type: "redirect", status, location };
  },
  error: (status: number) => {
    throw { type: "error", status };
  },
}));

// ---------------------------------------------------------------------------
// Mock repositories
// ---------------------------------------------------------------------------

vi.mock("$lib/db/repositories/sessions", () => ({
  getSession: (id: string) => mockSession,
}));

vi.mock("$lib/db/repositories/admin", () => ({
  getAdminByUsername: (username: string) => mockAdmin,
  adminExists: () => mockAdminExists,
}));

vi.mock("$lib/db/repositories/users", () => ({
  getUserMappingById: (id: number) => mockUser,
}));

// ---------------------------------------------------------------------------
// Dynamic import after mocks are in place
// ---------------------------------------------------------------------------

const {
  requireAdmin,
  requireUser,
  requireSetupIncomplete,
  isSetupComplete,
  SESSION_COOKIE_NAME,
  ADMIN_SESSION_TTL,
  USER_SESSION_TTL,
  ADMIN_COOKIE_OPTIONS,
  USER_COOKIE_OPTIONS,
} = await import("../auth");

// ---------------------------------------------------------------------------
// Mock RequestEvent helper
// ---------------------------------------------------------------------------

function createMockEvent(sessionId: string | undefined = undefined) {
  const deleteSpy = vi.fn();
  return {
    event: {
      cookies: {
        get: (name: string) => (name === SESSION_COOKIE_NAME ? sessionId : undefined),
        delete: deleteSpy,
      },
    } as unknown as import("@sveltejs/kit").RequestEvent,
    deleteSpy,
  };
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const validAdminSession: Session = {
  id: "sess-admin-1",
  user_ref: "admin-user",
  session_type: "admin",
  expires_at: "2099-01-01 00:00:00",
  created_at: "2024-01-01 00:00:00",
};

const validUserSession: Session = {
  id: "sess-user-1",
  user_ref: "42",
  session_type: "user",
  expires_at: "2099-01-01 00:00:00",
  created_at: "2024-01-01 00:00:00",
};

const validAdmin: AdminAccount = {
  id: 1,
  username: "admin-user",
  password_hash: "hashed",
  created_at: "2024-01-01 00:00:00",
  updated_at: "2024-01-01 00:00:00",
};

const validUser: UserMapping = {
  id: 42,
  plex_account_id: 1001,
  plex_uuid: "plex-uuid-1",
  plex_username: "plexuser",
  plex_email: "plex@example.com",
  plex_thumb: null,
  dispatcharr_user_id: null,
  dispatcharr_username: null,
  dispatcharr_xc_password_enc: null,
  dispatcharr_group_ids: "[]",
  dispatcharr_profile_id: null,
  provisioning_mode: "automatic",
  is_active: 1,
  created_at: "2024-01-01 00:00:00",
  updated_at: "2024-01-01 00:00:00",
  last_synced_at: null,
  last_accessed_at: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("auth guards", () => {
  beforeEach(() => {
    mockSession = null;
    mockAdmin = null;
    mockUser = null;
    mockAdminExists = false;
  });

  afterEach(() => {
    mockSession = null;
    mockAdmin = null;
    mockUser = null;
    mockAdminExists = false;
  });

  // -----------------------------------------------------------------------
  // Constants
  // -----------------------------------------------------------------------

  describe("constants", () => {
    it("exports SESSION_COOKIE_NAME", () => {
      expect(SESSION_COOKIE_NAME).toBe("otpravkarr_session");
    });

    it("exports ADMIN_SESSION_TTL as 3600", () => {
      expect(ADMIN_SESSION_TTL).toBe(3600);
    });

    it("exports USER_SESSION_TTL as 14400", () => {
      expect(USER_SESSION_TTL).toBe(14400);
    });

    it("exports ADMIN_COOKIE_OPTIONS with strict sameSite", () => {
      expect(ADMIN_COOKIE_OPTIONS).toEqual({
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        maxAge: 3600,
      });
    });

    it("exports USER_COOKIE_OPTIONS with lax sameSite", () => {
      expect(USER_COOKIE_OPTIONS).toEqual({
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: 14400,
      });
    });
  });

  // -----------------------------------------------------------------------
  // requireAdmin
  // -----------------------------------------------------------------------

  describe("requireAdmin", () => {
    it("throws redirect(303, '/login') when no cookie", async () => {
      const { event } = createMockEvent(undefined);

      try {
        await requireAdmin(event);
        expect.unreachable("should have thrown");
      } catch (e: unknown) {
        const err = e as { type: string; status: number; location: string };
        expect(err.type).toBe("redirect");
        expect(err.status).toBe(303);
        expect(err.location).toBe("/login");
      }
    });

    it("throws redirect when session not found", async () => {
      mockSession = null;
      const { event, deleteSpy } = createMockEvent("bad-session-id");

      try {
        await requireAdmin(event);
        expect.unreachable("should have thrown");
      } catch (e: unknown) {
        const err = e as { type: string; status: number; location: string };
        expect(err.type).toBe("redirect");
        expect(err.status).toBe(303);
        expect(err.location).toBe("/login");
      }

      expect(deleteSpy).toHaveBeenCalledWith(SESSION_COOKIE_NAME, { path: "/" });
    });

    it("throws redirect when session type is 'user' not 'admin'", async () => {
      mockSession = { ...validUserSession };
      const { event, deleteSpy } = createMockEvent("sess-user-1");

      try {
        await requireAdmin(event);
        expect.unreachable("should have thrown");
      } catch (e: unknown) {
        const err = e as { type: string; status: number; location: string };
        expect(err.type).toBe("redirect");
        expect(err.status).toBe(303);
        expect(err.location).toBe("/login");
      }

      expect(deleteSpy).toHaveBeenCalledWith(SESSION_COOKIE_NAME, { path: "/" });
    });

    it("throws redirect when admin not found by username", async () => {
      mockSession = { ...validAdminSession };
      mockAdmin = null;
      const { event, deleteSpy } = createMockEvent("sess-admin-1");

      try {
        await requireAdmin(event);
        expect.unreachable("should have thrown");
      } catch (e: unknown) {
        const err = e as { type: string; status: number; location: string };
        expect(err.type).toBe("redirect");
        expect(err.status).toBe(303);
        expect(err.location).toBe("/login");
      }

      expect(deleteSpy).toHaveBeenCalledWith(SESSION_COOKIE_NAME, { path: "/" });
    });

    it("returns AdminAccount on valid admin session", async () => {
      mockSession = { ...validAdminSession };
      mockAdmin = { ...validAdmin };
      const { event } = createMockEvent("sess-admin-1");

      const result = await requireAdmin(event);

      expect(result).toEqual(validAdmin);
    });

    it("does not delete cookie on missing cookie path", async () => {
      const { event, deleteSpy } = createMockEvent(undefined);

      try {
        await requireAdmin(event);
      } catch {
        // expected
      }

      expect(deleteSpy).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // requireUser
  // -----------------------------------------------------------------------

  describe("requireUser", () => {
    it("throws redirect(303, '/') when no cookie", async () => {
      const { event } = createMockEvent(undefined);

      try {
        await requireUser(event);
        expect.unreachable("should have thrown");
      } catch (e: unknown) {
        const err = e as { type: string; status: number; location: string };
        expect(err.type).toBe("redirect");
        expect(err.status).toBe(303);
        expect(err.location).toBe("/");
      }
    });

    it("throws redirect when session not found", async () => {
      mockSession = null;
      const { event, deleteSpy } = createMockEvent("bad-session");

      try {
        await requireUser(event);
        expect.unreachable("should have thrown");
      } catch (e: unknown) {
        const err = e as { type: string; status: number; location: string };
        expect(err.type).toBe("redirect");
        expect(err.status).toBe(303);
        expect(err.location).toBe("/");
      }

      expect(deleteSpy).toHaveBeenCalledWith(SESSION_COOKIE_NAME, { path: "/" });
    });

    it("throws redirect when session type is 'admin' not 'user'", async () => {
      mockSession = { ...validAdminSession };
      const { event, deleteSpy } = createMockEvent("sess-admin-1");

      try {
        await requireUser(event);
        expect.unreachable("should have thrown");
      } catch (e: unknown) {
        const err = e as { type: string; status: number; location: string };
        expect(err.type).toBe("redirect");
        expect(err.status).toBe(303);
        expect(err.location).toBe("/");
      }

      expect(deleteSpy).toHaveBeenCalledWith(SESSION_COOKIE_NAME, { path: "/" });
    });

    it("throws redirect when user_ref is not a valid integer", async () => {
      mockSession = { ...validUserSession, user_ref: "not-a-number" };
      const { event, deleteSpy } = createMockEvent("sess-user-1");

      try {
        await requireUser(event);
        expect.unreachable("should have thrown");
      } catch (e: unknown) {
        const err = e as { type: string; status: number; location: string };
        expect(err.type).toBe("redirect");
        expect(err.status).toBe(303);
        expect(err.location).toBe("/");
      }

      expect(deleteSpy).toHaveBeenCalledWith(SESSION_COOKIE_NAME, { path: "/" });
    });

    it("throws redirect when user mapping not found", async () => {
      mockSession = { ...validUserSession };
      mockUser = null;
      const { event, deleteSpy } = createMockEvent("sess-user-1");

      try {
        await requireUser(event);
        expect.unreachable("should have thrown");
      } catch (e: unknown) {
        const err = e as { type: string; status: number; location: string };
        expect(err.type).toBe("redirect");
        expect(err.status).toBe(303);
        expect(err.location).toBe("/");
      }

      expect(deleteSpy).toHaveBeenCalledWith(SESSION_COOKIE_NAME, { path: "/" });
    });

    it("returns UserMapping on valid user session", async () => {
      mockSession = { ...validUserSession };
      mockUser = { ...validUser };
      const { event } = createMockEvent("sess-user-1");

      const result = await requireUser(event);

      expect(result).toEqual(validUser);
    });

    it("does not delete cookie on missing cookie path", async () => {
      const { event, deleteSpy } = createMockEvent(undefined);

      try {
        await requireUser(event);
      } catch {
        // expected
      }

      expect(deleteSpy).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // requireSetupIncomplete
  // -----------------------------------------------------------------------

  describe("requireSetupIncomplete", () => {
    it("does not throw when adminExists returns false", () => {
      mockAdminExists = false;
      expect(() => requireSetupIncomplete()).not.toThrow();
    });

    it("throws error(404) when adminExists returns true", () => {
      mockAdminExists = true;

      try {
        requireSetupIncomplete();
        expect.unreachable("should have thrown");
      } catch (e: unknown) {
        const err = e as { type: string; status: number };
        expect(err.type).toBe("error");
        expect(err.status).toBe(404);
      }
    });
  });

  // -----------------------------------------------------------------------
  // isSetupComplete
  // -----------------------------------------------------------------------

  describe("isSetupComplete", () => {
    it("returns false when adminExists returns false", () => {
      mockAdminExists = false;
      expect(isSetupComplete()).toBe(false);
    });

    it("returns true when adminExists returns true", () => {
      mockAdminExists = true;
      expect(isSetupComplete()).toBe(true);
    });
  });
});
