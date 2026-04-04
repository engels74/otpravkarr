// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminApi: vi.fn(),
  getConfig: vi.fn(),
  getAccount: vi.fn(),
  getCachedFriends: vi.fn(),
  fetchFriends: vi.fn(),
}));

vi.mock("$lib/server/auth", () => ({
  requireAdminApi: mocks.requireAdminApi,
}));

vi.mock("$lib/db/repositories/config", () => ({
  getConfig: mocks.getConfig,
}));

vi.mock("$lib/plex/client", () => ({
  getAccount: mocks.getAccount,
}));

vi.mock("$lib/plex/friends", () => ({
  getCachedFriends: mocks.getCachedFriends,
  fetchFriends: mocks.fetchFriends,
}));

const fakeFriends = [
  { id: 1, email: "alice@example.com", status: "accepted", username: "alice" },
  { id: 2, email: "bob@example.com", status: "accepted", username: "bob" },
];

function createEvent() {
  return {
    cookies: { get: vi.fn() },
    locals: {},
  } as unknown;
}

describe("GET /api/internal/plex-friends", () => {
  beforeEach(() => {
    mocks.requireAdminApi.mockReset();
    mocks.getConfig.mockReset();
    mocks.getAccount.mockReset();
    mocks.getCachedFriends.mockReset();
    mocks.fetchFriends.mockReset();
  });

  it("returns cached friends when cache is fresh", async () => {
    mocks.requireAdminApi.mockResolvedValue({ id: 1, username: "admin" });
    mocks.getCachedFriends.mockReturnValue(fakeFriends);

    const { GET } = await import("./+server");
    const response = await GET(createEvent() as Parameters<typeof GET>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, friends: fakeFriends });
    expect(mocks.getConfig).not.toHaveBeenCalled();
    expect(mocks.getAccount).not.toHaveBeenCalled();
    expect(mocks.fetchFriends).not.toHaveBeenCalled();
  });

  it("fetches fresh friends when cache is empty", async () => {
    const fakeAccount = { token: "test-token" };
    mocks.requireAdminApi.mockResolvedValue({ id: 1, username: "admin" });
    mocks.getCachedFriends.mockReturnValue(null);
    mocks.getConfig.mockResolvedValue("plex-token-123");
    mocks.getAccount.mockResolvedValue(fakeAccount);
    mocks.fetchFriends.mockResolvedValue(fakeFriends);

    const { GET } = await import("./+server");
    const response = await GET(createEvent() as Parameters<typeof GET>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, friends: fakeFriends });
    expect(mocks.getConfig).toHaveBeenCalledWith("plex_admin_token");
    expect(mocks.getAccount).toHaveBeenCalledWith("plex-token-123");
    expect(mocks.fetchFriends).toHaveBeenCalledWith(fakeAccount);
  });

  it("returns 503 when plex_admin_token is missing", async () => {
    mocks.requireAdminApi.mockResolvedValue({ id: 1, username: "admin" });
    mocks.getCachedFriends.mockReturnValue(null);
    mocks.getConfig.mockResolvedValue(null);

    const { GET } = await import("./+server");
    const response = await GET(createEvent() as Parameters<typeof GET>[0]);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ ok: false, error: "missing_config" });
  });

  it("returns 502 on plex API error", async () => {
    mocks.requireAdminApi.mockResolvedValue({ id: 1, username: "admin" });
    mocks.getCachedFriends.mockReturnValue(null);
    mocks.getConfig.mockResolvedValue("plex-token-123");
    mocks.getAccount.mockRejectedValue(new Error("Plex server unreachable"));

    const { GET } = await import("./+server");
    const response = await GET(createEvent() as Parameters<typeof GET>[0]);
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({ ok: false, error: "plex_error", message: "Plex server unreachable" });
  });

  it("throws 401 when not authenticated as admin", async () => {
    const httpError = Object.assign(new Error(), {
      status: 401,
      body: { message: "Unauthorized" },
    });
    mocks.requireAdminApi.mockRejectedValue(httpError);

    const { GET } = await import("./+server");
    await expect(GET(createEvent() as Parameters<typeof GET>[0])).rejects.toMatchObject({
      status: 401,
    });

    expect(mocks.getCachedFriends).not.toHaveBeenCalled();
  });
});
