import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserMapping } from "$lib/db/types";

import UsersPage from "./+page.svelte";

const mocks = vi.hoisted(() => ({
  applyAction: vi.fn(async () => undefined),
  goto: vi.fn(async () => undefined),
  invalidateAll: vi.fn(async () => undefined),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("$app/forms", () => ({
  enhance: () => ({ destroy() {} }),
  applyAction: mocks.applyAction,
}));

vi.mock("$app/navigation", () => ({
  goto: mocks.goto,
  invalidateAll: mocks.invalidateAll,
}));

vi.mock("$app/state", () => ({
  page: {
    url: new URL("http://localhost/users"),
  },
}));

vi.mock("svelte-sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

const mapping: UserMapping = {
  id: 5,
  plex_account_id: 100,
  plex_uuid: "plex-uuid",
  plex_username: "testuser",
  plex_email: "test@example.com",
  plex_thumb: null,
  dispatcharr_user_id: 42,
  dispatcharr_username: "testuser",
  dispatcharr_xc_password_enc: "encrypted",
  dispatcharr_group_ids: "[]",
  dispatcharr_profile_id: null,
  provisioning_mode: "automatic",
  is_active: 1,
  group_selection_locked: 0,
  is_owner: 0,
  created_at: "2025-01-01 00:00:00",
  updated_at: "2025-01-01 00:00:00",
  last_synced_at: null,
  last_accessed_at: null,
};

const defaultData = {
  mappings: [mapping],
  groups: [] as { id: number; name: string; channelCount: number | null }[],
  profiles: [] as { id: number; name: string }[],
  driftByMappingId: {} as Record<number, boolean>,
  filters: { status: "all", mode: "all", search: "" },
};

function mockFetch(response: Response | Promise<Response>) {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function renderAndClickRotate() {
  render(UsersPage, { props: { data: defaultData } });
  await fireEvent.click(screen.getByRole("button", { name: "Open actions for testuser" }));
  await fireEvent.click(await screen.findByText("Rotate Credentials"));
}

describe("admin users page", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    mocks.applyAction.mockClear();
    mocks.goto.mockClear();
    mocks.invalidateAll.mockClear();
    mocks.toastSuccess.mockClear();
    mocks.toastError.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("rotates credentials through the internal API and refreshes page data", async () => {
    const fetchMock = mockFetch(Response.json({ ok: true }));

    await renderAndClickRotate();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/internal/rotate-credentials/5", {
        method: "POST",
      });
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Credentials rotated successfully.");
      expect(mocks.invalidateAll).toHaveBeenCalled();
    });
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("shows the server message when credential rotation fails", async () => {
    mockFetch(
      Response.json(
        { ok: false, error: "rotation_failed", message: "Dispatcharr API down" },
        { status: 500 },
      ),
    );

    await renderAndClickRotate();

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith("Dispatcharr API down");
    });
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.invalidateAll).not.toHaveBeenCalled();
  });

  it("shows the fallback error when credential rotation cannot reach the API", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("Network unavailable");
    });
    vi.stubGlobal("fetch", fetchMock);

    await renderAndClickRotate();

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith("Failed to rotate credentials.");
    });
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.invalidateAll).not.toHaveBeenCalled();
  });

  it("shows delete local mapping for eligible inactive local-only rows", async () => {
    render(UsersPage, {
      props: {
        data: {
          ...defaultData,
          mappings: [
            {
              ...mapping,
              dispatcharr_user_id: null,
              dispatcharr_username: null,
              dispatcharr_xc_password_enc: null,
              is_active: 0,
            },
          ],
        },
      },
    });

    await fireEvent.click(screen.getByRole("button", { name: "Open actions for testuser" }));

    expect(await screen.findByText("Delete local mapping")).toBeTruthy();
  });

  it("does not show delete local mapping for active remote-backed rows", async () => {
    render(UsersPage, { props: { data: defaultData } });

    await fireEvent.click(screen.getByRole("button", { name: "Open actions for testuser" }));

    expect(screen.queryByText("Delete local mapping")).toBeNull();
  });

  it("uses clear local-only destructive copy in the delete confirmation", async () => {
    render(UsersPage, {
      props: {
        data: {
          ...defaultData,
          mappings: [
            {
              ...mapping,
              dispatcharr_user_id: null,
              dispatcharr_username: null,
              dispatcharr_xc_password_enc: null,
              is_active: 0,
            },
          ],
        },
      },
    });

    await fireEvent.click(screen.getByRole("button", { name: "Open actions for testuser" }));
    await fireEvent.click(await screen.findByText("Delete local mapping"));

    expect(await screen.findByText("Delete local mapping for testuser?")).toBeTruthy();
    expect(
      screen.getByText(
        "This removes only the local otpravkarr mapping and saved metadata. It does not contact Dispatcharr. The Plex user can be provisioned again by signing in.",
      ),
    ).toBeTruthy();
  });
});
