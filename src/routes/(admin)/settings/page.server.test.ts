// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  configValues: new Map<string, string>(),
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
  mocks.DispatcharrClient.mockClear();
}

function createActionEvent(body: FormData) {
  return {
    request: new Request("http://localhost/settings", {
      method: "POST",
      body,
    }),
    locals: { admin: { username: "admin" } },
    getClientAddress: () => "127.0.0.1",
  };
}

describe("admin settings actions", () => {
  beforeEach(() => {
    resetStateAndMocks();
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
    body.set("allowed_origins", " https://alpha.example/path \nhttp://localhost:3000/ ");

    const result = await updateSecurity(
      createActionEvent(body) as unknown as Parameters<typeof updateSecurity>[0],
    );

    expect(result).toEqual({ success: true });
    expect(state.configValues.get("allowed_origins")).toBe(
      JSON.stringify(["https://alpha.example", "http://localhost:3000"]),
    );
    expect(mocks.invalidateConfigCache).toHaveBeenCalledOnce();
    expect(mocks.appendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "admin",
        detail: expect.objectContaining({
          section: "security",
          field: "allowed_origins",
          count: 2,
        }),
      }),
    );
  });

  it("keeps empty allowed origins as an empty list", async () => {
    const { actions } = await import("./+page.server");
    const updateSecurity = actions.updateSecurity;
    if (!updateSecurity) throw new Error("updateSecurity action is undefined");

    const body = new FormData();
    body.set("allowed_origins", "   \n   ");

    const result = await updateSecurity(
      createActionEvent(body) as unknown as Parameters<typeof updateSecurity>[0],
    );

    expect(result).toEqual({ success: true });
    expect(state.configValues.get("allowed_origins")).toBe(JSON.stringify([]));
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

    expect(result).toEqual({ success: true });
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

    state.configValues.set("plex_server_url", "http://plex.local");
    state.configValues.set("plex_admin_token", "existing-token");
    state.configValues.set("plex_machine_id", "old-mid");
    mocks.validateServerToken.mockResolvedValueOnce({
      friendlyName: "Plex",
      machineIdentifier: "new-mid",
      version: "1.0",
    });

    const body = new FormData();
    body.set("plex_server_url", "http://plex.local");
    body.set("plex_admin_token", "");

    const result = await updatePlexConnection(
      createActionEvent(body) as unknown as Parameters<typeof updatePlexConnection>[0],
    );

    expect(result).toEqual({ success: true, message: "Plex settings saved." });
    expect(mocks.validateServerToken).toHaveBeenCalledWith("http://plex.local", "existing-token");
    expect(mocks.setConfig).toHaveBeenCalledWith("plex_machine_id", "new-mid");
    expect(state.configValues.get("plex_machine_id")).toBe("new-mid");
  });

  it("returns 400 without config writes when updatePlexConnection validation fails", async () => {
    const { actions } = await import("./+page.server");
    const updatePlexConnection = actions.updatePlexConnection;
    if (!updatePlexConnection) throw new Error("updatePlexConnection action is undefined");

    state.configValues.set("plex_server_url", "http://plex.local");
    state.configValues.set("plex_admin_token", "existing-token");
    mocks.validateServerToken.mockRejectedValueOnce(
      new mocks.PlexConnectionError("Plex validation failed"),
    );

    const body = new FormData();
    body.set("plex_server_url", "http://plex.local");
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
    body.set("plex_server_url", "http://plex.local");
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

  it("returns 400 without config writes when updateDispatcharrConnection validation fails", async () => {
    const { actions } = await import("./+page.server");
    const updateDispatcharrConnection = actions.updateDispatcharrConnection;
    if (!updateDispatcharrConnection) {
      throw new Error("updateDispatcharrConnection action is undefined");
    }

    state.configValues.set("dispatcharr_url", "http://dispatcharr.local");
    state.configValues.set("dispatcharr_api_key", "existing-api-key");
    mocks.checkHealth.mockResolvedValueOnce({
      ok: true,
      data: { reachable: true, authValid: false },
    });

    const body = new FormData();
    body.set("dispatcharr_url", "http://dispatcharr.local");
    body.set("dispatcharr_api_key", "");

    const result = await updateDispatcharrConnection(
      createActionEvent(body) as unknown as Parameters<typeof updateDispatcharrConnection>[0],
    );

    expect(result).toMatchObject({
      status: 400,
      data: { error: "Dispatcharr API key is invalid" },
    });
    expect(mocks.DispatcharrClient).toHaveBeenCalledWith(
      "http://dispatcharr.local",
      "existing-api-key",
    );
    expect(mocks.createHealthEndpoints).toHaveBeenCalledOnce();
    expect(mocks.checkHealth).toHaveBeenCalledOnce();
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
    body.set("dispatcharr_url", "http://dispatcharr.local");
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

    state.configValues.set("dispatcharr_url", "http://dispatcharr.local");
    state.configValues.set("dispatcharr_api_key", "existing-api-key");
    mocks.checkHealth.mockResolvedValueOnce({
      ok: false,
      error: "connection failed",
    } as MockHealthResult);

    const body = new FormData();
    body.set("dispatcharr_url", "http://dispatcharr.local");
    body.set("dispatcharr_api_key", "");

    const result = await updateDispatcharrConnection(
      createActionEvent(body) as unknown as Parameters<typeof updateDispatcharrConnection>[0],
    );

    expect(result).toMatchObject({
      status: 400,
      data: { error: "Could not connect to Dispatcharr" },
    });
    expect(mocks.DispatcharrClient).toHaveBeenCalledWith(
      "http://dispatcharr.local",
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

    state.configValues.set("dispatcharr_url", "http://dispatcharr.local");
    state.configValues.set("dispatcharr_api_key", "existing-api-key");
    mocks.checkHealth.mockResolvedValueOnce({
      ok: true,
      data: { reachable: false, authValid: true },
    });

    const body = new FormData();
    body.set("dispatcharr_url", "http://dispatcharr.local");
    body.set("dispatcharr_api_key", "");

    const result = await updateDispatcharrConnection(
      createActionEvent(body) as unknown as Parameters<typeof updateDispatcharrConnection>[0],
    );

    expect(result).toMatchObject({
      status: 400,
      data: { error: "Dispatcharr server is unreachable" },
    });
    expect(mocks.DispatcharrClient).toHaveBeenCalledWith(
      "http://dispatcharr.local",
      "existing-api-key",
    );
    expect(mocks.createHealthEndpoints).toHaveBeenCalledOnce();
    expect(mocks.checkHealth).toHaveBeenCalledOnce();
    expect(mocks.setConfig).not.toHaveBeenCalled();
    expect(mocks.invalidateConfigCache).not.toHaveBeenCalled();
  });

  it("disables updateDefaultProvisioning to prevent no-op config writes", async () => {
    const { actions } = await import("./+page.server");
    const updateDefaultProvisioning = actions.updateDefaultProvisioning;
    if (!updateDefaultProvisioning) {
      throw new Error("updateDefaultProvisioning action is undefined");
    }

    const body = new FormData();
    body.set("default_provisioning_mode", "automatic");
    body.set("default_group_id", "1");
    body.set("default_profile_id", "2");

    const result = await updateDefaultProvisioning(
      createActionEvent(body) as unknown as Parameters<typeof updateDefaultProvisioning>[0],
    );

    expect(result).toMatchObject({
      status: 400,
      data: {
        error:
          "Default provisioning overrides are currently unavailable because runtime provisioning does not consume these settings.",
      },
    });
    expect(mocks.setConfig).not.toHaveBeenCalled();
    expect(mocks.invalidateConfigCache).not.toHaveBeenCalled();
  });
});
