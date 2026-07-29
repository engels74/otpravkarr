// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  configValues: new Map<string, string>(),
  bundles: new Map<
    string,
    { id: string; slug: string; display_name: string; enabled: number; group_ids: string }
  >(),
}));

type MockHealthResult =
  | { ok: true; data: { reachable: boolean; authValid: boolean } }
  | { ok: false; error: string };

const mocks = vi.hoisted(() => {
  class MockPlexAuthError extends Error {}
  class MockPlexConnectionError extends Error {}

  const checkHealth = vi.fn<() => Promise<MockHealthResult>>(async () => ({
    ok: true,
    data: { reachable: true, authValid: true },
  }));

  return {
    requireAdmin: vi.fn(async () => undefined),
    getConfig: vi.fn(async (key: string) => state.configValues.get(key) ?? null),
    setConfig: vi.fn(async (key: string, value: string) => {
      state.configValues.set(key, value);
    }),
    invalidateConfigCache: vi.fn(),
    appendAuditLog: vi.fn(),
    createSyncJob: vi.fn(async () => ({
      name: "plex-dispatcharr-sync",
      interval: 15 * 60 * 1000,
      fn: async () => undefined,
    })),
    schedulerRegister: vi.fn(),
    validateServerToken: vi.fn(async () => ({
      friendlyName: "Plex",
      machineIdentifier: "mid",
      version: "1.0",
    })),
    checkHealth,
    createHealthEndpoints: vi.fn(() => ({
      checkHealth,
    })),
    listChannelGroups: vi.fn(async () => ({
      ok: true as const,
      data: [
        { id: 1, name: "News", channel_count: 10 },
        { id: 2, name: "Sports", channel_count: 20 },
        { id: 3, name: "Graveyard", channel_count: 0 },
      ],
    })),
    db: {
      prepare: vi.fn((sql: string) => ({
        get: (id: string) => {
          if (!sql.startsWith("SELECT id, slug")) return undefined;
          const bundle = state.bundles.get(id);
          return bundle ? { id: bundle.id, slug: bundle.slug } : undefined;
        },
        run: (...values: unknown[]) => {
          if (sql.startsWith("INSERT INTO lineup_bundles")) {
            const [id, slug, displayName, enabled, groupIds] = values as [
              string,
              string,
              string,
              number,
              string,
            ];
            if ([...state.bundles.values()].some((bundle) => bundle.slug === slug)) {
              throw new Error("unique");
            }
            state.bundles.set(id, {
              id,
              slug,
              display_name: displayName,
              enabled,
              group_ids: groupIds,
            });
          }
          if (sql.startsWith("UPDATE lineup_bundles")) {
            const [displayName, enabled, groupIds, id] = values as [string, number, string, string];
            const bundle = state.bundles.get(id);
            if (bundle)
              Object.assign(bundle, { display_name: displayName, enabled, group_ids: groupIds });
          }
        },
      })),
    },
    DispatcharrClient: vi.fn(function (
      this: { url: string; apiKey: string },
      url: string,
      apiKey: string,
    ) {
      this.url = url;
      this.apiKey = apiKey;
    }),
    PlexAuthError: MockPlexAuthError,
    PlexConnectionError: MockPlexConnectionError,
  };
});

vi.mock("$lib/server/auth", () => ({
  requireAdmin: mocks.requireAdmin,
}));

vi.mock("$lib/db/repositories/config", () => ({
  getConfig: mocks.getConfig,
  setConfig: mocks.setConfig,
  invalidateConfigCache: mocks.invalidateConfigCache,
}));
vi.mock("$lib/db/connection", () => ({
  db: mocks.db,
}));

vi.mock("$lib/dispatcharr/endpoints/channel-groups", () => ({
  listChannelGroups: mocks.listChannelGroups,
}));

vi.mock("$lib/db/repositories/audit", () => ({
  appendAuditLog: mocks.appendAuditLog,
}));

vi.mock("$lib/db/types", () => ({
  AuditAction: {
    CONFIG_CHANGED: "config.changed",
  },
}));

vi.mock("$lib/plex/client", () => ({
  validateServerToken: mocks.validateServerToken,
}));

vi.mock("$lib/plex/types", () => ({
  PlexAuthError: mocks.PlexAuthError,
  PlexConnectionError: mocks.PlexConnectionError,
}));

vi.mock("$lib/dispatcharr/client", () => ({
  DispatcharrClient: mocks.DispatcharrClient,
  // The route now builds its clients via the factories; delegate to the same
  // mocked constructor so `DispatcharrClient` call assertions still hold.
  createInteractiveClient: (url: string, key: string) => new mocks.DispatcharrClient(url, key),
  createRobustClient: (url: string, key: string) => new mocks.DispatcharrClient(url, key),
}));

vi.mock("$lib/dispatcharr/endpoints/health", () => ({
  createHealthEndpoints: mocks.createHealthEndpoints,
}));

vi.mock("$lib/scheduler/jobs/sync", () => ({
  createSyncJob: mocks.createSyncJob,
}));

vi.mock("$lib/scheduler/runner", () => ({
  scheduler: {
    register: mocks.schedulerRegister,
  },
}));

function resetStateAndMocks() {
  state.configValues.clear();
  state.bundles.clear();
  mocks.requireAdmin.mockClear();
  mocks.getConfig.mockClear();
  mocks.setConfig.mockClear();
  mocks.invalidateConfigCache.mockClear();
  mocks.appendAuditLog.mockClear();
  mocks.createSyncJob.mockClear();
  mocks.schedulerRegister.mockClear();
  mocks.validateServerToken.mockClear();
  mocks.checkHealth.mockClear();
  mocks.createHealthEndpoints.mockClear();
  mocks.listChannelGroups.mockClear();
  mocks.db.prepare.mockClear();
  mocks.DispatcharrClient.mockClear();
}

function createActionEvent(body: FormData, origin?: string) {
  const headers: HeadersInit = origin ? { Origin: origin } : {};
  return {
    request: new Request("http://localhost/settings", {
      method: "POST",
      body,
      headers,
    }),
    url: new URL("http://localhost/settings"),
    locals: { admin: { username: "admin" } },
    getClientAddress: () => "127.0.0.1",
  };
}

describe("admin settings actions", () => {
  beforeEach(() => {
    resetStateAndMocks();
  });
  it("fails closed for invalid lineup policies and non-live group IDs", async () => {
    const { actions } = await import("./+page.server");
    const updateLineupPolicy = actions.updateLineupPolicy;
    if (!updateLineupPolicy) throw new Error("updateLineupPolicy action is undefined");

    const body = new FormData();
    body.set("lineup_policy_default", "all_groups");
    body.set("lineup_fixed_group_ids", "[]");
    body.set("lineup_core_group_ids", "[]");
    body.set("default_selectable_groups", "[]");
    const invalidPolicy = await updateLineupPolicy(
      createActionEvent(body) as unknown as Parameters<typeof updateLineupPolicy>[0],
    );
    expect(invalidPolicy).toMatchObject({ status: 400, data: { error: "Invalid lineup policy" } });

    state.configValues.set("dispatcharr_url", "http://dispatcharr");
    state.configValues.set("dispatcharr_api_key", "key");
    body.set("lineup_policy_default", "fixed");
    body.set("lineup_fixed_group_ids", "[3]");
    const invalidGroup = await updateLineupPolicy(
      createActionEvent(body) as unknown as Parameters<typeof updateLineupPolicy>[0],
    );
    expect(invalidGroup).toMatchObject({
      status: 400,
      data: { error: "Lineup groups must be live, non-quarantine group IDs" },
    });
    expect(mocks.setConfig).not.toHaveBeenCalledWith("lineup_policy_default", "fixed");
  });

  it("persists validated lineup policy groups without widening the approved set", async () => {
    const { actions } = await import("./+page.server");
    const updateLineupPolicy = actions.updateLineupPolicy;
    if (!updateLineupPolicy) throw new Error("updateLineupPolicy action is undefined");
    state.configValues.set("dispatcharr_url", "http://dispatcharr");
    state.configValues.set("dispatcharr_api_key", "key");

    const body = new FormData();
    body.set("lineup_policy_default", "core_bundles");
    body.set("lineup_fixed_group_ids", "[2,1]");
    body.set("lineup_core_group_ids", "[1]");
    body.set("default_selectable_groups", "[2]");
    const result = await updateLineupPolicy(
      createActionEvent(body) as unknown as Parameters<typeof updateLineupPolicy>[0],
    );

    expect(result).toMatchObject({ success: true });
    expect(state.configValues.get("lineup_fixed_group_ids")).toBe("[2,1]");
    expect(state.configValues.get("lineup_core_group_ids")).toBe("[1]");
    expect(state.configValues.get("default_selectable_groups")).toBe("[2]");
    expect(mocks.appendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ detail: expect.objectContaining({ section: "lineup_policy" }) }),
    );
  });

  it("creates a validated stable lineup bundle", async () => {
    const { actions } = await import("./+page.server");
    const saveLineupBundle = actions.saveLineupBundle;
    if (!saveLineupBundle) throw new Error("saveLineupBundle action is undefined");
    state.configValues.set("dispatcharr_url", "http://dispatcharr");
    state.configValues.set("dispatcharr_api_key", "key");

    const body = new FormData();
    body.set("bundle_id", "sports-v1");
    body.set("bundle_slug", "sports");
    body.set("bundle_display_name", "Sports");
    body.set("bundle_enabled", "true");
    body.set("bundle_group_ids", "[2,1]");
    body.set("bundle_catalog_version", "2");
    const result = await saveLineupBundle(
      createActionEvent(body) as unknown as Parameters<typeof saveLineupBundle>[0],
    );

    expect(result).toMatchObject({ success: true });
    expect(state.bundles.get("sports-v1")).toMatchObject({
      slug: "sports",
      group_ids: "[2,1]",
    });
    expect(state.configValues.get("lineup_bundle_catalog_version")).toBe("2");
  });

  it("rejects invalid origins in updateSecurity", async () => {
    const { actions } = await import("./+page.server");
    const updateSecurity = actions.updateSecurity;
    if (!updateSecurity) throw new Error("updateSecurity action is undefined");

    const body = new FormData();
    body.set("allowed_origins", "https://good.example\njavascript:alert(1)");

    const result = await updateSecurity(
      createActionEvent(body) as unknown as Parameters<typeof updateSecurity>[0],
    );

    expect(result).toMatchObject({
      status: 400,
      data: { error: "Invalid origin: javascript:alert(1)" },
    });
    expect(mocks.setConfig).not.toHaveBeenCalledWith("allowed_origins", expect.any(String));
    expect(mocks.invalidateConfigCache).not.toHaveBeenCalled();
  });

  it("normalizes valid newline-separated origins in updateSecurity", async () => {
    const { actions } = await import("./+page.server");
    const updateSecurity = actions.updateSecurity;
    if (!updateSecurity) throw new Error("updateSecurity action is undefined");

    const body = new FormData();
    body.set(
      "allowed_origins",
      " https://alpha.example/path \nhttp://localhost:3000/ \nhttp://localhost ",
    );

    const result = await updateSecurity(
      createActionEvent(body) as unknown as Parameters<typeof updateSecurity>[0],
    );

    expect(result).toEqual({ success: true, message: "Security settings saved." });
    expect(state.configValues.get("allowed_origins")).toBe(
      JSON.stringify(["https://alpha.example", "http://localhost:3000", "http://localhost"]),
    );
    expect(mocks.invalidateConfigCache).toHaveBeenCalledOnce();
    expect(mocks.appendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "admin",
        detail: expect.objectContaining({
          section: "security",
          field: "allowed_origins",
          count: 3,
        }),
      }),
    );
  });

  it("rejects an empty allowed-origins list to prevent CSRF lockout", async () => {
    const { actions } = await import("./+page.server");
    const updateSecurity = actions.updateSecurity;
    if (!updateSecurity) throw new Error("updateSecurity action is undefined");

    const body = new FormData();
    body.set("allowed_origins", "   \n   ");

    const result = await updateSecurity(
      createActionEvent(body) as unknown as Parameters<typeof updateSecurity>[0],
    );

    expect(result).toMatchObject({
      status: 400,
      data: { error: "At least one origin is required" },
    });
    expect(mocks.setConfig).not.toHaveBeenCalled();
    expect(mocks.invalidateConfigCache).not.toHaveBeenCalled();
    expect(mocks.appendAuditLog).not.toHaveBeenCalled();
  });

  it("rejects allowed origins that exclude the request Origin header (lockout guard)", async () => {
    const { actions } = await import("./+page.server");
    const updateSecurity = actions.updateSecurity;
    if (!updateSecurity) throw new Error("updateSecurity action is undefined");

    const body = new FormData();
    body.set("allowed_origins", "https://other.example");

    const result = await updateSecurity(
      createActionEvent(body, "http://localhost") as unknown as Parameters<
        typeof updateSecurity
      >[0],
    );

    expect(result).toMatchObject({
      status: 400,
      data: {
        error:
          "Current origin (http://localhost) must be included in the allowed origins list to avoid locking yourself out.",
      },
    });
    expect(mocks.setConfig).not.toHaveBeenCalled();
    expect(mocks.invalidateConfigCache).not.toHaveBeenCalled();
  });

  it("falls back to url.origin for lockout guard when Origin header is missing", async () => {
    const { actions } = await import("./+page.server");
    const updateSecurity = actions.updateSecurity;
    if (!updateSecurity) throw new Error("updateSecurity action is undefined");

    // No Origin header; url.origin is http://localhost which is NOT in the allowed list
    const body = new FormData();
    body.set("allowed_origins", "https://other.example");

    const result = await updateSecurity(
      createActionEvent(body) as unknown as Parameters<typeof updateSecurity>[0],
    );

    expect(result).toMatchObject({
      status: 400,
      data: {
        error:
          "Current origin (http://localhost) must be included in the allowed origins list to avoid locking yourself out.",
      },
    });
    expect(mocks.setConfig).not.toHaveBeenCalled();
    expect(mocks.invalidateConfigCache).not.toHaveBeenCalled();
  });

  it("allows saving origins when request Origin is in the allowed list", async () => {
    const { actions } = await import("./+page.server");
    const updateSecurity = actions.updateSecurity;
    if (!updateSecurity) throw new Error("updateSecurity action is undefined");

    const body = new FormData();
    body.set("allowed_origins", "http://localhost\nhttps://app.example");

    const result = await updateSecurity(
      createActionEvent(body, "http://localhost") as unknown as Parameters<
        typeof updateSecurity
      >[0],
    );

    expect(result).toEqual({ success: true, message: "Security settings saved." });
    expect(mocks.setConfig).toHaveBeenCalledWith(
      "allowed_origins",
      JSON.stringify(["http://localhost", "https://app.example"]),
    );
  });

  it("rejects oversized sync intervals in updateSyncSettings before persisting", async () => {
    const { actions } = await import("./+page.server");
    const updateSyncSettings = actions.updateSyncSettings;
    if (!updateSyncSettings) throw new Error("updateSyncSettings action is undefined");

    state.configValues.set("sync_interval_minutes", "15");

    const body = new FormData();
    body.set("sync_interval_minutes", "1441");

    const result = await updateSyncSettings(
      createActionEvent(body) as unknown as Parameters<typeof updateSyncSettings>[0],
    );

    expect(result).toMatchObject({
      status: 400,
      data: { error: "Sync interval must be a number between 1 and 1440" },
    });
    expect(state.configValues.get("sync_interval_minutes")).toBe("15");
    expect(mocks.setConfig).not.toHaveBeenCalled();
    expect(mocks.createSyncJob).not.toHaveBeenCalled();
    expect(mocks.schedulerRegister).not.toHaveBeenCalled();
    expect(mocks.invalidateConfigCache).not.toHaveBeenCalled();
    expect(mocks.appendAuditLog).not.toHaveBeenCalled();
  });

  it("re-registers sync job immediately in updateSyncSettings", async () => {
    const { actions } = await import("./+page.server");
    const updateSyncSettings = actions.updateSyncSettings;
    if (!updateSyncSettings) throw new Error("updateSyncSettings action is undefined");

    const syncJob = {
      name: "plex-dispatcharr-sync",
      interval: 10 * 60 * 1000,
      fn: async () => undefined,
    };
    mocks.createSyncJob.mockResolvedValueOnce(syncJob);

    const body = new FormData();
    body.set("sync_interval_minutes", "10");

    const result = await updateSyncSettings(
      createActionEvent(body) as unknown as Parameters<typeof updateSyncSettings>[0],
    );

    expect(result).toEqual({ success: true, message: "Sync settings saved." });
    expect(state.configValues.get("sync_interval_minutes")).toBe("10");
    expect(mocks.createSyncJob).toHaveBeenCalledOnce();
    expect(mocks.schedulerRegister).toHaveBeenCalledWith(syncJob);
    expect(mocks.invalidateConfigCache).toHaveBeenCalledOnce();
    expect(mocks.appendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "admin",
        detail: expect.objectContaining({
          section: "sync",
          field: "sync_interval_minutes",
          value: 10,
        }),
      }),
    );
  });

  it("persists plex_machine_id on successful updatePlexConnection validation", async () => {
    const { actions } = await import("./+page.server");
    const updatePlexConnection = actions.updatePlexConnection;
    if (!updatePlexConnection) throw new Error("updatePlexConnection action is undefined");

    state.configValues.set("plex_server_url", "http://localhost:32400");
    state.configValues.set("plex_admin_token", "existing-token");
    state.configValues.set("plex_machine_id", "old-mid");
    mocks.validateServerToken.mockResolvedValueOnce({
      friendlyName: "Plex",
      machineIdentifier: "new-mid",
      version: "1.0",
    });

    const body = new FormData();
    body.set("plex_server_url", "http://localhost:32400");
    body.set("plex_admin_token", "");

    const result = await updatePlexConnection(
      createActionEvent(body) as unknown as Parameters<typeof updatePlexConnection>[0],
    );

    expect(result).toEqual({ success: true, message: "Plex settings saved." });
    expect(mocks.validateServerToken).toHaveBeenCalledWith(
      "http://localhost:32400",
      "existing-token",
    );
    expect(mocks.setConfig).toHaveBeenCalledWith("plex_machine_id", "new-mid");
    expect(state.configValues.get("plex_machine_id")).toBe("new-mid");
  });

  it("returns 400 without config writes when updatePlexConnection validation fails", async () => {
    const { actions } = await import("./+page.server");
    const updatePlexConnection = actions.updatePlexConnection;
    if (!updatePlexConnection) throw new Error("updatePlexConnection action is undefined");

    state.configValues.set("plex_server_url", "http://localhost:32400");
    state.configValues.set("plex_admin_token", "existing-token");
    mocks.validateServerToken.mockRejectedValueOnce(
      new mocks.PlexConnectionError("Plex validation failed"),
    );

    const body = new FormData();
    body.set("plex_server_url", "http://localhost:32400");
    body.set("plex_admin_token", "");

    const result = await updatePlexConnection(
      createActionEvent(body) as unknown as Parameters<typeof updatePlexConnection>[0],
    );

    expect(result).toMatchObject({
      status: 400,
      data: { error: "Could not connect to Plex server" },
    });
    expect(mocks.setConfig).not.toHaveBeenCalled();
    expect(mocks.invalidateConfigCache).not.toHaveBeenCalled();
  });

  it("returns 400 when updatePlexConnection is missing required inputs", async () => {
    const { actions } = await import("./+page.server");
    const updatePlexConnection = actions.updatePlexConnection;
    if (!updatePlexConnection) throw new Error("updatePlexConnection action is undefined");

    const body = new FormData();
    body.set("plex_server_url", "http://localhost:32400");
    body.set("plex_admin_token", "");

    const result = await updatePlexConnection(
      createActionEvent(body) as unknown as Parameters<typeof updatePlexConnection>[0],
    );

    expect(result).toMatchObject({
      status: 400,
      data: { error: "Plex token and server URL are required" },
    });
    expect(mocks.validateServerToken).not.toHaveBeenCalled();
    expect(mocks.setConfig).not.toHaveBeenCalled();
    expect(mocks.invalidateConfigCache).not.toHaveBeenCalled();
  });

  it("returns 400 without calling validateServerToken when plex URL uses non-loopback http", async () => {
    const { actions } = await import("./+page.server");
    const updatePlexConnection = actions.updatePlexConnection;
    if (!updatePlexConnection) throw new Error("updatePlexConnection action is undefined");

    const body = new FormData();
    body.set("plex_server_url", "http://plex.example.com:32400");
    body.set("plex_admin_token", "admin-token");

    const result = await updatePlexConnection(
      createActionEvent(body) as unknown as Parameters<typeof updatePlexConnection>[0],
    );

    expect(result).toMatchObject({
      status: 400,
      data: {
        error: expect.stringContaining("HTTPS"),
      },
    });
    expect(mocks.validateServerToken).not.toHaveBeenCalled();
    expect(mocks.setConfig).not.toHaveBeenCalled();
    expect(mocks.invalidateConfigCache).not.toHaveBeenCalled();
  });

  it("returns 400 without config writes when updateDispatcharrConnection validation fails", async () => {
    const { actions } = await import("./+page.server");
    const updateDispatcharrConnection = actions.updateDispatcharrConnection;
    if (!updateDispatcharrConnection) {
      throw new Error("updateDispatcharrConnection action is undefined");
    }

    state.configValues.set("dispatcharr_url", "http://localhost:9192");
    state.configValues.set("dispatcharr_api_key", "existing-api-key");
    mocks.checkHealth.mockResolvedValueOnce({
      ok: true,
      data: { reachable: true, authValid: false },
    });

    const body = new FormData();
    body.set("dispatcharr_url", "http://localhost:9192");
    body.set("dispatcharr_api_key", "");

    const result = await updateDispatcharrConnection(
      createActionEvent(body) as unknown as Parameters<typeof updateDispatcharrConnection>[0],
    );

    expect(result).toMatchObject({
      status: 400,
      data: { error: "Dispatcharr API key is invalid" },
    });
    expect(mocks.DispatcharrClient).toHaveBeenCalledWith(
      "http://localhost:9192",
      "existing-api-key",
    );
    expect(mocks.createHealthEndpoints).toHaveBeenCalledOnce();
    expect(mocks.checkHealth).toHaveBeenCalledOnce();
    expect(mocks.setConfig).not.toHaveBeenCalled();
    expect(mocks.invalidateConfigCache).not.toHaveBeenCalled();
  });

  it("returns 400 with HTTPS guard when dispatcharr URL uses non-loopback http", async () => {
    const { actions } = await import("./+page.server");
    const updateDispatcharrConnection = actions.updateDispatcharrConnection;
    if (!updateDispatcharrConnection) {
      throw new Error("updateDispatcharrConnection action is undefined");
    }

    state.configValues.set("dispatcharr_api_key", "existing-api-key");

    const body = new FormData();
    body.set("dispatcharr_url", "http://dispatcharr.example.com");
    body.set("dispatcharr_api_key", "");

    const result = await updateDispatcharrConnection(
      createActionEvent(body) as unknown as Parameters<typeof updateDispatcharrConnection>[0],
    );

    expect(result).toMatchObject({
      status: 400,
      data: {
        error:
          "Dispatcharr URL must use HTTPS (HTTP only allowed for localhost, 127.0.0.1, or [::1])",
      },
    });
    expect(mocks.DispatcharrClient).not.toHaveBeenCalled();
    expect(mocks.createHealthEndpoints).not.toHaveBeenCalled();
    expect(mocks.checkHealth).not.toHaveBeenCalled();
    expect(mocks.setConfig).not.toHaveBeenCalled();
    expect(mocks.invalidateConfigCache).not.toHaveBeenCalled();
    expect(mocks.appendAuditLog).not.toHaveBeenCalled();
  });

  it("returns 400 when dispatcharr external URL uses non-loopback http", async () => {
    const { actions } = await import("./+page.server");
    const updateDispatcharrConnection = actions.updateDispatcharrConnection;
    if (!updateDispatcharrConnection) {
      throw new Error("updateDispatcharrConnection action is undefined");
    }

    state.configValues.set("dispatcharr_api_key", "existing-api-key");

    const body = new FormData();
    body.set("dispatcharr_url", "https://dispatcharr.local");
    body.set("dispatcharr_api_key", "");
    body.set("dispatcharr_external_url", "http://public.example.com");

    const result = await updateDispatcharrConnection(
      createActionEvent(body) as unknown as Parameters<typeof updateDispatcharrConnection>[0],
    );

    expect(result).toMatchObject({
      status: 400,
      data: {
        error: "External URL must use HTTPS (HTTP only allowed for localhost, 127.0.0.1, or [::1])",
      },
    });
    expect(mocks.DispatcharrClient).not.toHaveBeenCalled();
    expect(mocks.setConfig).not.toHaveBeenCalled();
    expect(mocks.invalidateConfigCache).not.toHaveBeenCalled();
  });

  it("returns 400 when updateDispatcharrConnection is missing required inputs", async () => {
    const { actions } = await import("./+page.server");
    const updateDispatcharrConnection = actions.updateDispatcharrConnection;
    if (!updateDispatcharrConnection) {
      throw new Error("updateDispatcharrConnection action is undefined");
    }

    const body = new FormData();
    body.set("dispatcharr_url", "http://localhost:9192");
    body.set("dispatcharr_api_key", "");

    const result = await updateDispatcharrConnection(
      createActionEvent(body) as unknown as Parameters<typeof updateDispatcharrConnection>[0],
    );

    expect(result).toMatchObject({
      status: 400,
      data: { error: "Dispatcharr URL and API key are required" },
    });
    expect(mocks.DispatcharrClient).not.toHaveBeenCalled();
    expect(mocks.createHealthEndpoints).not.toHaveBeenCalled();
    expect(mocks.checkHealth).not.toHaveBeenCalled();
    expect(mocks.setConfig).not.toHaveBeenCalled();
    expect(mocks.invalidateConfigCache).not.toHaveBeenCalled();
  });

  it("returns 400 without config writes when updateDispatcharrConnection cannot connect", async () => {
    const { actions } = await import("./+page.server");
    const updateDispatcharrConnection = actions.updateDispatcharrConnection;
    if (!updateDispatcharrConnection) {
      throw new Error("updateDispatcharrConnection action is undefined");
    }

    state.configValues.set("dispatcharr_url", "http://localhost:9192");
    state.configValues.set("dispatcharr_api_key", "existing-api-key");
    mocks.checkHealth.mockResolvedValueOnce({
      ok: false,
      error: "connection failed",
    } as MockHealthResult);

    const body = new FormData();
    body.set("dispatcharr_url", "http://localhost:9192");
    body.set("dispatcharr_api_key", "");

    const result = await updateDispatcharrConnection(
      createActionEvent(body) as unknown as Parameters<typeof updateDispatcharrConnection>[0],
    );

    expect(result).toMatchObject({
      status: 400,
      data: { error: "Could not connect to Dispatcharr" },
    });
    expect(mocks.DispatcharrClient).toHaveBeenCalledWith(
      "http://localhost:9192",
      "existing-api-key",
    );
    expect(mocks.createHealthEndpoints).toHaveBeenCalledOnce();
    expect(mocks.checkHealth).toHaveBeenCalledOnce();
    expect(mocks.setConfig).not.toHaveBeenCalled();
    expect(mocks.invalidateConfigCache).not.toHaveBeenCalled();
  });

  it("returns 400 without config writes when updateDispatcharrConnection sees an unreachable server", async () => {
    const { actions } = await import("./+page.server");
    const updateDispatcharrConnection = actions.updateDispatcharrConnection;
    if (!updateDispatcharrConnection) {
      throw new Error("updateDispatcharrConnection action is undefined");
    }

    state.configValues.set("dispatcharr_url", "http://localhost:9192");
    state.configValues.set("dispatcharr_api_key", "existing-api-key");
    mocks.checkHealth.mockResolvedValueOnce({
      ok: true,
      data: { reachable: false, authValid: true },
    });

    const body = new FormData();
    body.set("dispatcharr_url", "http://localhost:9192");
    body.set("dispatcharr_api_key", "");

    const result = await updateDispatcharrConnection(
      createActionEvent(body) as unknown as Parameters<typeof updateDispatcharrConnection>[0],
    );

    expect(result).toMatchObject({
      status: 400,
      data: { error: "Dispatcharr server is unreachable" },
    });
    expect(mocks.DispatcharrClient).toHaveBeenCalledWith(
      "http://localhost:9192",
      "existing-api-key",
    );
    expect(mocks.createHealthEndpoints).toHaveBeenCalledOnce();
    expect(mocks.checkHealth).toHaveBeenCalledOnce();
    expect(mocks.setConfig).not.toHaveBeenCalled();
    expect(mocks.invalidateConfigCache).not.toHaveBeenCalled();
  });

  it("skips the audit log but still invalidates cache on a no-op plex re-save (ISSUE-006)", async () => {
    const { actions } = await import("./+page.server");
    const updatePlexConnection = actions.updatePlexConnection;
    if (!updatePlexConnection) throw new Error("updatePlexConnection action is undefined");

    state.configValues.set("plex_server_url", "http://localhost:32400");
    state.configValues.set("plex_admin_token", "existing-token");
    state.configValues.set("plex_machine_id", "mid");
    // Default validateServerToken mock returns machineIdentifier "mid" → nothing changes.

    const body = new FormData();
    body.set("plex_server_url", "http://localhost:32400");
    body.set("plex_admin_token", "");

    const result = await updatePlexConnection(
      createActionEvent(body) as unknown as Parameters<typeof updatePlexConnection>[0],
    );

    expect(result).toEqual({
      success: true,
      message: "Connection verified, no changes needed.",
    });
    expect(mocks.invalidateConfigCache).toHaveBeenCalledOnce();
    expect(mocks.appendAuditLog).not.toHaveBeenCalled();
  });

  it("writes exactly one plex audit row naming changed fields on a real change (ISSUE-006)", async () => {
    const { actions } = await import("./+page.server");
    const updatePlexConnection = actions.updatePlexConnection;
    if (!updatePlexConnection) throw new Error("updatePlexConnection action is undefined");

    state.configValues.set("plex_server_url", "http://localhost:32400");
    state.configValues.set("plex_admin_token", "existing-token");
    state.configValues.set("plex_machine_id", "mid");

    const body = new FormData();
    body.set("plex_server_url", "https://plex.example.com:32400");
    body.set("plex_admin_token", "");

    const result = await updatePlexConnection(
      createActionEvent(body) as unknown as Parameters<typeof updatePlexConnection>[0],
    );

    expect(result).toEqual({ success: true, message: "Plex settings saved." });
    expect(mocks.appendAuditLog).toHaveBeenCalledOnce();
    expect(mocks.appendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "admin",
        detail: expect.objectContaining({ section: "plex", fields: ["plex_server_url"] }),
      }),
    );
  });

  it("skips the audit log but still invalidates cache on a no-op dispatcharr re-save (ISSUE-006)", async () => {
    const { actions } = await import("./+page.server");
    const updateDispatcharrConnection = actions.updateDispatcharrConnection;
    if (!updateDispatcharrConnection) {
      throw new Error("updateDispatcharrConnection action is undefined");
    }

    state.configValues.set("dispatcharr_url", "http://localhost:9192");
    state.configValues.set("dispatcharr_api_key", "existing-api-key");
    // No external URL set; form sends none → "" === "" → no change.
    // Default checkHealth mock → reachable + authValid.

    const body = new FormData();
    body.set("dispatcharr_url", "http://localhost:9192");
    body.set("dispatcharr_api_key", "");

    const result = await updateDispatcharrConnection(
      createActionEvent(body) as unknown as Parameters<typeof updateDispatcharrConnection>[0],
    );

    expect(result).toEqual({
      success: true,
      message: "Connection verified, no changes needed.",
    });
    expect(mocks.invalidateConfigCache).toHaveBeenCalledOnce();
    expect(mocks.appendAuditLog).not.toHaveBeenCalled();
  });

  it("writes exactly one dispatcharr audit row naming changed fields on a real change (ISSUE-006)", async () => {
    const { actions } = await import("./+page.server");
    const updateDispatcharrConnection = actions.updateDispatcharrConnection;
    if (!updateDispatcharrConnection) {
      throw new Error("updateDispatcharrConnection action is undefined");
    }

    state.configValues.set("dispatcharr_url", "http://localhost:9192");
    state.configValues.set("dispatcharr_api_key", "existing-api-key");

    const body = new FormData();
    body.set("dispatcharr_url", "http://localhost:9193");
    body.set("dispatcharr_api_key", "");

    const result = await updateDispatcharrConnection(
      createActionEvent(body) as unknown as Parameters<typeof updateDispatcharrConnection>[0],
    );

    expect(result).toEqual({ success: true, message: "Dispatcharr settings saved." });
    expect(mocks.appendAuditLog).toHaveBeenCalledOnce();
    expect(mocks.appendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "admin",
        detail: expect.objectContaining({ section: "dispatcharr", fields: ["dispatcharr_url"] }),
      }),
    );
  });

  it("persists subscription defaults (self-select toggle + selectable groups)", async () => {
    const { actions } = await import("./+page.server");
    const updateDefaultProvisioning = actions.updateDefaultProvisioning;
    if (!updateDefaultProvisioning) {
      throw new Error("updateDefaultProvisioning action is undefined");
    }

    const body = new FormData();
    body.set("allow_user_self_select", "true");
    body.set("default_selectable_groups", "[2, 1, 2]");

    const result = await updateDefaultProvisioning(
      createActionEvent(body) as unknown as Parameters<typeof updateDefaultProvisioning>[0],
    );

    expect(result).toMatchObject({ success: true });
    expect(mocks.setConfig).toHaveBeenCalledWith("allow_user_self_select", "true");
    // Deduped + sorted JSON array.
    expect(mocks.setConfig).toHaveBeenCalledWith("default_selectable_groups", "[1,2]");
    expect(mocks.invalidateConfigCache).toHaveBeenCalled();
    expect(mocks.appendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "config.changed" }),
    );
  });

  it("stores allow_user_self_select=false when the toggle is off", async () => {
    const { actions } = await import("./+page.server");
    const updateDefaultProvisioning = actions.updateDefaultProvisioning;
    if (!updateDefaultProvisioning) throw new Error("missing action");

    const body = new FormData();
    body.set("allow_user_self_select", "false");
    body.set("default_selectable_groups", "[]");

    await updateDefaultProvisioning(
      createActionEvent(body) as unknown as Parameters<typeof updateDefaultProvisioning>[0],
    );

    expect(mocks.setConfig).toHaveBeenCalledWith("allow_user_self_select", "false");
    expect(mocks.setConfig).toHaveBeenCalledWith("default_selectable_groups", "[]");
  });

  it("rejects a malformed selectable group payload without writing config", async () => {
    const { actions } = await import("./+page.server");
    const updateDefaultProvisioning = actions.updateDefaultProvisioning;
    if (!updateDefaultProvisioning) throw new Error("missing action");

    const body = new FormData();
    body.set("allow_user_self_select", "true");
    body.set("default_selectable_groups", '["nope"]');

    const result = await updateDefaultProvisioning(
      createActionEvent(body) as unknown as Parameters<typeof updateDefaultProvisioning>[0],
    );

    expect(result).toMatchObject({ status: 400 });
    expect(mocks.setConfig).not.toHaveBeenCalled();
  });
});
