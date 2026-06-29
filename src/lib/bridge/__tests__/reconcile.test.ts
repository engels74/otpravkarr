// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DispatcharrClient } from "$lib/dispatcharr/client";

const mocks = vi.hoisted(() => ({
  reconcileSync: vi.fn(),
  reconcileQuarantineGroups: vi.fn(),
  reconcileSubscriptions: vi.fn(),
  reconcileEcmScope: vi.fn(),
}));

vi.mock("$lib/bridge/lifecycle", () => ({ reconcileSync: mocks.reconcileSync }));
vi.mock("$lib/bridge/quarantine-sync", () => ({
  reconcileQuarantineGroups: mocks.reconcileQuarantineGroups,
}));
vi.mock("$lib/bridge/subscription-sync", () => ({
  reconcileSubscriptions: mocks.reconcileSubscriptions,
}));
vi.mock("$lib/bridge/ecm-scope", () => ({ reconcileEcmScope: mocks.reconcileEcmScope }));

import { runFullReconcile } from "../reconcile";

const client = { baseUrl: "http://d", apiKey: "k" } as unknown as DispatcharrClient;
const report = { unmappedFriends: 0, disabled: 0, orphaned: 0, refreshed: 0, errors: [] };
const subscriptionsResult = {
  groupsReconciled: 0,
  profilesRecreated: 0,
  usersRepatched: 0,
  errors: [],
};

beforeEach(() => {
  mocks.reconcileSync.mockReset().mockResolvedValue(report);
  mocks.reconcileQuarantineGroups.mockReset().mockResolvedValue({ names: [], source: "plugin" });
  mocks.reconcileSubscriptions.mockReset().mockResolvedValue(subscriptionsResult);
  mocks.reconcileEcmScope.mockReset().mockResolvedValue({
    ok: true,
    data: { updated: false, added: [], reason: "already_in_scope" },
  });
});

describe("runFullReconcile (ISSUE-005)", () => {
  it("runs the full sequence in order and returns each result", async () => {
    const order: string[] = [];
    mocks.reconcileSync.mockImplementationOnce(async () => {
      order.push("sync");
      return report;
    });
    mocks.reconcileQuarantineGroups.mockImplementationOnce(async () => {
      order.push("quarantine");
      return { names: ["Graveyard"], source: "plugin" };
    });
    mocks.reconcileSubscriptions.mockImplementationOnce(async () => {
      order.push("subscriptions");
      return subscriptionsResult;
    });
    mocks.reconcileEcmScope.mockImplementationOnce(async () => {
      order.push("ecm");
      return { ok: true, data: { updated: true, added: ["Sports"] } };
    });

    const result = await runFullReconcile(client, "plex-token");

    // Quarantine before subscriptions (renamed junk stays hidden); ECM last
    // (freshly created group profiles included).
    expect(order).toEqual(["sync", "quarantine", "subscriptions", "ecm"]);
    expect(mocks.reconcileSync).toHaveBeenCalledWith(client, "plex-token");
    expect(result.report).toEqual(report);
    expect(result.ecmScope).toEqual({ ok: true, data: { updated: true, added: ["Sports"] } });
  });

  it("isolates a failing post-sync step so the rest still run", async () => {
    mocks.reconcileQuarantineGroups.mockRejectedValueOnce(new Error("quarantine boom"));

    const result = await runFullReconcile(client, "plex-token");

    expect(result.quarantine).toEqual({ error: "quarantine boom" });
    // The failure did not abort the remaining steps.
    expect(mocks.reconcileSubscriptions).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileEcmScope).toHaveBeenCalledTimes(1);
    expect(result.report).toEqual(report);
  });

  it("stringifies a non-Error thrown by a step", async () => {
    mocks.reconcileEcmScope.mockRejectedValueOnce("ecm string failure");

    const result = await runFullReconcile(client, "plex-token");

    expect(result.ecmScope).toEqual({ error: "ecm string failure" });
  });

  it("propagates a reconcileSync throw so the caller logs SYNC_FAILED", async () => {
    mocks.reconcileSync.mockRejectedValueOnce(new Error("plex down"));

    await expect(runFullReconcile(client, "plex-token")).rejects.toThrow("plex down");
    // reconcileSync owns the completion/failure semantics; later steps never ran.
    expect(mocks.reconcileQuarantineGroups).not.toHaveBeenCalled();
    expect(mocks.reconcileSubscriptions).not.toHaveBeenCalled();
    expect(mocks.reconcileEcmScope).not.toHaveBeenCalled();
  });

  it("never acquires the scheduler lock itself (callers own exclusivity)", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/bridge/reconcile.ts"), "utf8");
    // No lock acquisition (no runExclusive call) and no dependency on the runner.
    expect(source).not.toMatch(/runExclusive\s*\(/);
    expect(source).not.toContain("scheduler/runner");
  });
});
