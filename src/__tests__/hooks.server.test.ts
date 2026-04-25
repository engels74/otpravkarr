// @vitest-environment node

import type { RequestEvent } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminAccount, Session, UserMapping } from "$lib/db/types";

let mockSession: Session | null = null;
let mockAdmin: AdminAccount | null = null;
let mockUser: UserMapping | null = null;

vi.mock("@sveltejs/kit/hooks", () => ({
  sequence:
    (
      ...handlers: Array<
        (input: {
          event: MockEvent;
          resolve: (event: MockEvent) => Promise<Response>;
        }) => Promise<Response>
      >
    ) =>
    async ({
      event,
      resolve,
    }: {
      event: MockEvent;
      resolve: (event: MockEvent) => Promise<Response>;
    }) => {
      const run = async (index: number, nextEvent: MockEvent): Promise<Response> => {
        const handler = handlers[index];
        if (!handler) {
          return resolve(nextEvent);
        }

        return handler({
          event: nextEvent,
          resolve: (updatedEvent) => run(index + 1, updatedEvent),
        });
      };

      return run(0, event);
    },
}));

type MockEvent = RequestEvent;

vi.mock("$app/environment", () => ({
  building: false,
}));

vi.mock("$env/dynamic/private", () => ({
  env: {
    HOST: "localhost",
    PORT: "3000",
    ORIGIN: "http://localhost:3000",
  },
}));

vi.mock("$lib/crypto/bootstrap", () => ({
  createBootstrapToken: () => "bootstrap-token",
}));

vi.mock("$lib/db/connection", () => ({
  initializeDatabase: vi.fn(async () => {}),
}));

vi.mock("$lib/db/repositories/admin", () => ({
  adminExists: () => true,
  getAdminByUsername: () => mockAdmin,
}));

vi.mock("$lib/db/repositories/config", () => ({
  getConfig: vi.fn(async () => null),
}));

vi.mock("$lib/db/repositories/sessions", () => ({
  getSession: () => mockSession,
  refreshSession: vi.fn(),
}));

vi.mock("$lib/db/repositories/users", () => ({
  getUserMappingById: () => mockUser,
}));

vi.mock("$lib/scheduler/jobs/audit-rotation", () => ({
  createAuditRotationJob: () => ({ id: "audit-rotation" }),
}));

vi.mock("$lib/scheduler/jobs/cleanup", () => ({
  createCleanupJob: () => ({ id: "cleanup" }),
}));

vi.mock("$lib/scheduler/jobs/health", () => ({
  createHealthJob: () => ({
    name: "health-check",
    interval: 5 * 60 * 1000,
    fn: vi.fn(async () => {}),
  }),
}));

vi.mock("$lib/scheduler/jobs/sync", () => ({
  createSyncJob: vi.fn(async () => ({ id: "sync" })),
}));

vi.mock("$lib/scheduler/runner", () => ({
  scheduler: {
    register: vi.fn(),
    start: vi.fn(),
  },
}));

vi.mock("$lib/server/auth", () => ({
  SESSION_COOKIE_NAME: "otpravkarr_session",
  ADMIN_SESSION_TTL: 3600,
  USER_SESSION_TTL: 14400,
  ADMIN_COOKIE_OPTIONS: {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    maxAge: 3600,
  },
  USER_COOKIE_OPTIONS: {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 14400,
  },
  isSetupComplete: () => true,
}));

vi.mock("$lib/server/csrf", () => ({
  validateOrigin: vi.fn(),
}));

vi.mock("$lib/server/env", () => ({
  validateEnv: vi.fn(),
}));

vi.mock("$lib/server/logging", () => ({
  createRequestLogger:
    () =>
    async ({
      event,
      resolve,
    }: {
      event: unknown;
      resolve: (event: unknown) => Promise<Response>;
    }) =>
      resolve(event),
}));

const { handle } = await import("../hooks.server");
const { validateOrigin } = await import("$lib/server/csrf");
const { getConfig } = await import("$lib/db/repositories/config");
const mockValidateOrigin = vi.mocked(validateOrigin);
const mockGetConfig = vi.mocked(getConfig);

const validAdminSession: Session = {
  id: "sess-admin-1",
  user_ref: "admin-user",
  session_type: "admin",
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

function createMockEvent({
  sessionId,
  method = "GET",
  origin,
  url = "http://localhost/dashboard",
}: {
  sessionId?: string;
  method?: string;
  origin?: string;
  url?: string;
} = {}) {
  const headers: Record<string, string> = {};
  if (origin !== undefined) {
    headers.Origin = origin;
  }

  return {
    cookies: {
      get: (name: string) => (name === "otpravkarr_session" ? sessionId : undefined),
      set: vi.fn(),
    },
    setHeaders: vi.fn(),
    locals: {} as App.Locals,
    request: new Request(url, { method, headers }),
    url: new URL(url),
  } as unknown as MockEvent;
}

function expectStandardSecurityHeaders(response: Response): void {
  expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  expect(response.headers.get("Permissions-Policy")).toBe(
    "camera=(), microphone=(), geolocation=()",
  );
}

describe("hooks sessionResolver", () => {
  beforeEach(() => {
    mockSession = null;
    mockAdmin = null;
    mockUser = null;
    mockValidateOrigin.mockReset();
    mockGetConfig.mockReset();
    mockGetConfig.mockResolvedValue(null);
  });

  it("populates locals for a valid admin session", async () => {
    mockSession = { ...validAdminSession };
    mockAdmin = { ...validAdmin };
    const event = createMockEvent({ sessionId: "sess-admin-1" });

    await handle({
      event,
      resolve: async () => new Response(null, { status: 200 }),
    });

    expect(event.locals.session).toEqual({
      id: "sess-admin-1",
      type: "admin",
      userRef: "admin-user",
    });
    expect(event.locals.admin).toEqual({ id: 1, username: "admin-user" });
    expect(event.locals.user).toBeNull();
  });

  it("clears locals.session when session_type is invalid", async () => {
    mockSession = {
      id: "sess-invalid-1",
      user_ref: "mystery-user",
      session_type: "service",
      expires_at: "2099-01-01 00:00:00",
      created_at: "2024-01-01 00:00:00",
    } as unknown as Session;
    mockAdmin = { ...validAdmin };
    mockUser = null;
    const event = createMockEvent({ sessionId: "sess-invalid-1" });

    await handle({
      event,
      resolve: async () => new Response(null, { status: 200 }),
    });

    expect(event.locals.session).toBeNull();
    expect(event.locals.admin).toBeNull();
    expect(event.locals.user).toBeNull();
  });
});

describe("hooks security headers", () => {
  beforeEach(() => {
    mockSession = null;
    mockAdmin = null;
    mockUser = null;
    mockValidateOrigin.mockReset();
    mockGetConfig.mockReset();
    mockGetConfig.mockResolvedValue(null);
  });

  it("adds security headers to normal responses", async () => {
    const event = createMockEvent();

    const response = await handle({
      event,
      resolve: async () => new Response(null, { status: 200 }),
    });

    expectStandardSecurityHeaders(response);
  });

  it("returns hostile-origin CSRF rejections with security headers", async () => {
    // Authenticated session so the request reaches CSRF (not the 401 unauth gate).
    mockSession = { ...validAdminSession };
    mockAdmin = { ...validAdmin };
    mockValidateOrigin.mockImplementation(() => {
      throw {
        status: 403,
        body: { message: "CSRF validation failed: origin not allowed" },
      };
    });
    const event = createMockEvent({
      sessionId: "sess-admin-1",
      method: "POST",
      origin: "http://evil.example",
      url: "http://localhost/api/internal/sync",
    });
    const resolveSpy = vi.fn(async () => new Response(null, { status: 204 }));

    const response = await handle({ event, resolve: resolveSpy });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      message: "CSRF validation failed: origin not allowed",
    });
    expectStandardSecurityHeaders(response);
    expect(event.setHeaders).not.toHaveBeenCalled();
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it("returns missing-Origin CSRF rejections with security headers", async () => {
    mockSession = { ...validAdminSession };
    mockAdmin = { ...validAdmin };
    mockValidateOrigin.mockImplementation(() => {
      throw {
        status: 403,
        body: { message: "CSRF validation failed: missing Origin header" },
      };
    });
    const event = createMockEvent({
      sessionId: "sess-admin-1",
      method: "POST",
      url: "http://localhost/api/internal/sync",
    });

    const resolveSpy = vi.fn(async () => new Response(null, { status: 204 }));

    const response = await handle({
      event,
      resolve: resolveSpy,
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      message: "CSRF validation failed: missing Origin header",
    });
    expectStandardSecurityHeaders(response);
    expect(event.setHeaders).not.toHaveBeenCalled();
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it("returns 401 for unauthenticated requests to internal API endpoints", async () => {
    const event = createMockEvent({
      method: "POST",
      origin: "http://localhost",
      url: "http://localhost/api/internal/sync",
    });
    const resolveSpy = vi.fn(async () => new Response(null, { status: 204 }));

    const response = await handle({ event, resolve: resolveSpy });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expectStandardSecurityHeaders(response);
    expect(resolveSpy).not.toHaveBeenCalled();
  });
});
