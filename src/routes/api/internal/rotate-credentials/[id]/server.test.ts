// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserMappingNotFoundError } from "$lib/bridge/types";

const mocks = vi.hoisted(() => ({
  requireAdminApi: vi.fn(),
  getUserMappingById: vi.fn(),
  getConfig: vi.fn(),
  DispatcharrClient: vi.fn(),
  rotateCredentialsForMappingId: vi.fn(),
}));

vi.mock("$lib/server/auth", () => ({
  requireAdminApi: mocks.requireAdminApi,
}));

vi.mock("$lib/db/repositories/users", () => ({
  getUserMappingById: mocks.getUserMappingById,
}));

vi.mock("$lib/db/repositories/config", () => ({
  getConfig: mocks.getConfig,
}));

vi.mock("$lib/dispatcharr/client", () => ({
  DispatcharrClient: mocks.DispatcharrClient,
}));

vi.mock("$lib/bridge/lifecycle", () => ({
  rotateCredentialsForMappingId: mocks.rotateCredentialsForMappingId,
}));

function resetAll() {
  vi.resetAllMocks();
}

function makeEvent(id: string) {
  return {
    params: { id },
    cookies: {},
    locals: {},
    request: new Request(`http://localhost/api/internal/rotate-credentials/${id}`, {
      method: "POST",
    }),
    getClientAddress: () => "127.0.0.1",
  } as unknown as Parameters<Awaited<typeof import("./+server")>["POST"]>[0];
}

const MAPPING = {
  id: 5,
  plex_account_id: 100,
  plex_uuid: "abc",
  plex_username: "testuser",
  plex_email: "test@test.com",
  plex_thumb: null,
  dispatcharr_user_id: 42,
  dispatcharr_username: "testuser",
  dispatcharr_xc_password_enc: "enc",
  dispatcharr_group_ids: "[]",
  dispatcharr_profile_id: null,
  provisioning_mode: "automatic",
  is_active: 1,
  last_synced_at: null,
  last_accessed_at: null,
  created_at: "2025-01-01",
  updated_at: "2025-01-01",
};

describe("POST /api/internal/rotate-credentials/[id]", () => {
  beforeEach(() => {
    resetAll();
  });

  it("returns 200 on successful rotation", async () => {
    const { POST } = await import("./+server");

    mocks.requireAdminApi.mockResolvedValue({ id: 1, username: "admin" });
    mocks.getUserMappingById.mockReturnValue(MAPPING);
    mocks.getConfig.mockImplementation(async (key: string) => {
      if (key === "dispatcharr_url") return "http://dispatcharr.local";
      if (key === "dispatcharr_api_key") return "api-key-123";
      return null;
    });
    mocks.DispatcharrClient.mockImplementation(function (this: { baseUrl: string }, url: string) {
      this.baseUrl = url;
    });
    mocks.rotateCredentialsForMappingId.mockResolvedValue(undefined);

    const response = await POST(makeEvent("5"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.requireAdminApi).toHaveBeenCalled();
    expect(mocks.getUserMappingById).not.toHaveBeenCalled();
    expect(mocks.rotateCredentialsForMappingId).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "http://dispatcharr.local" }),
      5,
      {
        actor: "admin",
        ipAddress: "127.0.0.1",
      },
    );
  });

  it("returns 400 for non-integer ID", async () => {
    const { POST } = await import("./+server");

    const response = await POST(makeEvent("abc"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "invalid_id" });
    expect(mocks.requireAdminApi).not.toHaveBeenCalled();
  });

  it("returns 400 for decimal ID", async () => {
    const { POST } = await import("./+server");

    const response = await POST(makeEvent("1.5"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "invalid_id" });
  });

  it("returns 400 for zero ID", async () => {
    const { POST } = await import("./+server");

    const response = await POST(makeEvent("0"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "invalid_id" });
  });

  it("returns 400 for negative ID", async () => {
    const { POST } = await import("./+server");

    const response = await POST(makeEvent("-1"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "invalid_id" });
  });

  it("throws 401 for unauthenticated request", async () => {
    const { POST } = await import("./+server");

    const httpError = Object.assign(new Error("Unauthorized"), { status: 401 });
    mocks.requireAdminApi.mockRejectedValue(httpError);

    await expect(POST(makeEvent("5"))).rejects.toMatchObject({
      status: 401,
    });
  });

  it("returns 404 when user mapping not found", async () => {
    const { POST } = await import("./+server");

    mocks.requireAdminApi.mockResolvedValue({ id: 1, username: "admin" });
    mocks.getConfig.mockImplementation(async (key: string) => {
      if (key === "dispatcharr_url") return "http://dispatcharr.local";
      if (key === "dispatcharr_api_key") return "api-key-123";
      return null;
    });
    mocks.rotateCredentialsForMappingId.mockRejectedValue(
      new UserMappingNotFoundError("Cannot rotate credentials: user mapping not found"),
    );

    const response = await POST(makeEvent("999"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "not_found" });
  });

  it("returns 503 when dispatcharr_url is missing", async () => {
    const { POST } = await import("./+server");

    mocks.requireAdminApi.mockResolvedValue({ id: 1, username: "admin" });
    mocks.getUserMappingById.mockReturnValue(MAPPING);
    mocks.getConfig.mockResolvedValue(null);

    const response = await POST(makeEvent("5"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: "missing_config" });
  });

  it("returns 503 when dispatcharr_api_key is missing", async () => {
    const { POST } = await import("./+server");

    mocks.requireAdminApi.mockResolvedValue({ id: 1, username: "admin" });
    mocks.getUserMappingById.mockReturnValue(MAPPING);
    mocks.getConfig.mockImplementation(async (key: string) => {
      if (key === "dispatcharr_url") return "http://dispatcharr.local";
      return null;
    });

    const response = await POST(makeEvent("5"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: "missing_config" });
  });

  it("returns 500 when rotateCredentials throws", async () => {
    const { POST } = await import("./+server");

    mocks.requireAdminApi.mockResolvedValue({ id: 1, username: "admin" });
    mocks.getUserMappingById.mockReturnValue(MAPPING);
    mocks.getConfig.mockImplementation(async (key: string) => {
      if (key === "dispatcharr_url") return "http://dispatcharr.local";
      if (key === "dispatcharr_api_key") return "api-key-123";
      return null;
    });
    mocks.DispatcharrClient.mockImplementation(function (this: { baseUrl: string }, url: string) {
      this.baseUrl = url;
    });
    mocks.rotateCredentialsForMappingId.mockRejectedValue(new Error("Dispatcharr API down"));

    const response = await POST(makeEvent("5"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      error: "rotation_failed",
      message: "Dispatcharr API down",
    });
  });
});
