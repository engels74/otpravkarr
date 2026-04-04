// @vitest-environment node

import type { RequestEvent } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

type MockEvent = RequestEvent;

const state = vi.hoisted(() => ({
  setupComplete: true,
}));

const mocks = vi.hoisted(() => ({
  createBootstrapToken: vi.fn(() => "bootstrap-token"),
  initializeDatabase: vi.fn(async () => {}),
  validateEnv: vi.fn(),
}));

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
  createBootstrapToken: mocks.createBootstrapToken,
}));

vi.mock("$lib/db/connection", () => ({
  initializeDatabase: mocks.initializeDatabase,
}));

vi.mock("$lib/db/repositories/admin", () => ({
  adminExists: () => true,
  getAdminByUsername: () => null,
}));

vi.mock("$lib/db/repositories/config", () => ({
  getConfig: vi.fn(async () => null),
}));

vi.mock("$lib/db/repositories/sessions", () => ({
  getSession: () => null,
}));

vi.mock("$lib/db/repositories/users", () => ({
  getUserMappingById: () => null,
}));

vi.mock("$lib/scheduler/jobs/audit-rotation", () => ({
  createAuditRotationJob: () => ({ id: "audit-rotation" }),
}));

vi.mock("$lib/scheduler/jobs/cleanup", () => ({
  createCleanupJob: () => ({ id: "cleanup" }),
}));

vi.mock("$lib/scheduler/jobs/health", () => ({
  createHealthJob: () => ({ id: "health" }),
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
  isSetupComplete: vi.fn(async () => state.setupComplete),
}));

vi.mock("$lib/server/csrf", () => ({
  validateOrigin: vi.fn(),
}));

vi.mock("$lib/server/env", () => ({
  validateEnv: mocks.validateEnv,
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

function createMockEvent(pathname = "/setup"): MockEvent {
  return {
    cookies: {
      get: () => undefined,
    },
    locals: {} as App.Locals,
    request: new Request(`http://localhost${pathname}`, { method: "GET" }),
    url: new URL(`http://localhost${pathname}`),
  } as unknown as MockEvent;
}

beforeEach(() => {
  state.setupComplete = true;
  mocks.createBootstrapToken.mockClear();
  mocks.initializeDatabase.mockClear();
  mocks.validateEnv.mockClear();
  vi.resetModules();
});

describe("hooks bootstrap token recovery", () => {
  it("creates a bootstrap token when setup is incomplete, even if admin exists", async () => {
    state.setupComplete = false;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { handle } = await import("../hooks.server");
      const response = await handle({
        event: createMockEvent("/setup"),
        resolve: async () => new Response(null, { status: 200 }),
      });

      expect(response.status).toBe(200);
      expect(mocks.createBootstrapToken).toHaveBeenCalledOnce();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("does not create a bootstrap token once setup is complete", async () => {
    state.setupComplete = true;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { handle } = await import("../hooks.server");
      const response = await handle({
        event: createMockEvent("/dashboard"),
        resolve: async () => new Response(null, { status: 200 }),
      });

      expect(response.status).toBe(200);
      expect(mocks.createBootstrapToken).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });
});
