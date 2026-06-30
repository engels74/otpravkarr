import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserMapping } from "$lib/db/types";

import UsersPage from "./+page.svelte";

type MockActionResult = {
  type: "success" | "failure" | "error";
  data?: { error?: string };
  error?: Error;
};

const state = vi.hoisted(() => ({
  queuedResults: [] as MockActionResult[],
}));

const mocks = vi.hoisted(() => ({
  applyAction: vi.fn(async () => undefined),
  goto: vi.fn(async () => undefined),
  invalidateAll: vi.fn(async () => undefined),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("$app/forms", () => ({
  // Settings-style harness: invoke the returned enhance callback with a queued
  // result and a mock update() that mirrors SvelteKit's reset behaviour
  // (form.reset() unless { reset: false }). Forms without a queued result are
  // left untouched, so the existing dropdown/dialog tests are unaffected.
  enhance: (
    node: HTMLFormElement,
    submit?: () =>
      | ((args: {
          result: MockActionResult;
          update: (options?: { reset?: boolean; invalidateAll?: boolean }) => Promise<void>;
        }) => Promise<void>)
      | void,
  ) => {
    const onSubmit = async (event: Event) => {
      event.preventDefault();
      const callback = submit?.();
      const result = state.queuedResults.shift();
      if (!callback || !result) return;
      await callback({
        result,
        update: async (options?: { reset?: boolean; invalidateAll?: boolean }) => {
          if (options?.reset !== false) {
            node.reset();
          }
        },
      });
    };
    node.addEventListener("submit", onSubmit);
    return {
      destroy() {
        node.removeEventListener("submit", onSubmit);
      },
    };
  },
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
  await fireEvent.click(await screen.findByRole("menuitem", { name: /Rotate Credentials/ }));
  const dialog = await screen.findByRole("dialog");
  await fireEvent.click(within(dialog).getByRole("button", { name: /Rotate now/ }));
}

async function openChangeGroupLockForm(data: typeof defaultData) {
  render(UsersPage, { props: { data } });
  await fireEvent.click(screen.getByRole("button", { name: "Open actions for testuser" }));
  await fireEvent.click(await screen.findByRole("menuitem", { name: /Change Group/ }));
  const dialog = await screen.findByRole("dialog");
  const lockForm = dialog.querySelector<HTMLFormElement>('form[action="?/setGroupLock"]');
  if (!lockForm) throw new Error("Lock form not found");
  const checkbox = lockForm.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!checkbox) throw new Error("Lock checkbox not found");
  return { lockForm, checkbox };
}

describe("admin users page", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    state.queuedResults = [];
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

  it("gates rotation behind the confirm dialog and does not rotate on cancel", async () => {
    const fetchMock = mockFetch(Response.json({ ok: true }));

    render(UsersPage, { props: { data: defaultData } });
    await fireEvent.click(screen.getByRole("button", { name: "Open actions for testuser" }));
    await fireEvent.click(await screen.findByRole("menuitem", { name: /Rotate Credentials/ }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /Rotate now/ })).toBeTruthy();
    // Opening the dialog must not rotate yet.
    expect(fetchMock).not.toHaveBeenCalled();

    await fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    // Cancelling must leave the rotate fetch untouched.
    expect(fetchMock).not.toHaveBeenCalled();
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

  it("requires a concrete profile before saving a null-profile mapping", async () => {
    render(UsersPage, {
      props: {
        data: {
          ...defaultData,
          profiles: [{ id: 7, name: "Sports profile" }],
        },
      },
    });

    await fireEvent.click(screen.getByRole("button", { name: "Open actions for testuser" }));
    await fireEvent.click(await screen.findByText("Change Profile"));

    expect(screen.queryByText("All channels (no profile)")).toBeNull();
    expect(
      screen.getByText("Choose a channel profile to enable saving.", { exact: false }),
    ).toBeTruthy();

    const saveButton = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);

    await fireEvent.click(screen.getByLabelText("Sports profile"));

    expect(saveButton.disabled).toBe(false);
  });

  it("keeps the lock checkbox checked after a successful Save lock (ISSUE-001)", async () => {
    const { lockForm, checkbox } = await openChangeGroupLockForm({
      ...defaultData,
      groups: [{ id: 1, name: "Group A", channelCount: 5 }],
    });

    // Default mapping is unlocked → checkbox starts unchecked (defaultChecked
    // false), so a stray form.reset() would revert the toggle: discriminating.
    expect(checkbox.checked).toBe(false);
    await fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    state.queuedResults.push({ type: "success" });
    await fireEvent.submit(lockForm);

    // reset:false → no form.reset(); the just-toggled checkbox stays checked.
    await waitFor(() => expect(checkbox.checked).toBe(true));
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Lock updated.");
  });

  it("restores the lock checkbox to the stored value after a failed Save lock (ISSUE-001)", async () => {
    // Locked fixture: the checkbox starts CHECKED. Toggling it OFF then failing
    // must restore it to checked (ground truth) — not leave the optimistic
    // unlock and not force-uncheck via form.reset(). With the default unlocked
    // fixture, ground-truth-restore and an erroneous reset both yield
    // "unchecked", so this locked fixture is what makes the test discriminating.
    const { lockForm, checkbox } = await openChangeGroupLockForm({
      ...defaultData,
      mappings: [{ ...mapping, group_selection_locked: 1 }],
      groups: [{ id: 1, name: "Group A", channelCount: 5 }],
    });

    expect(checkbox.checked).toBe(true);
    await fireEvent.click(checkbox); // attempt to unlock
    expect(checkbox.checked).toBe(false);

    state.queuedResults.push({ type: "failure", data: { error: "Failed to update lock." } });
    await fireEvent.submit(lockForm);

    // Rejected save → reflect the authoritative stored value (locked), not the
    // un-persisted optimistic toggle.
    await waitFor(() => expect(checkbox.checked).toBe(true));
    expect(mocks.toastError).toHaveBeenCalledWith("Failed to update lock.");
  });
});
