import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PortalPage from "./+page.svelte";

type MockActionResult = {
  type: "success" | "failure" | "error";
  data?: { error?: string; message?: string };
  error?: Error;
};

const state = vi.hoisted(() => ({
  queuedResults: [] as MockActionResult[],
  // When true, update() never resolves — simulating invalidateAll blocked on a
  // slow reload. The refresh toast must already have fired before this await, or
  // it gets delayed/swallowed by the reload (ISSUE-004).
  hangUpdate: false,
}));

const mocks = vi.hoisted(() => ({
  applyAction: vi.fn(async () => undefined),
  invalidateAll: vi.fn(async () => undefined),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("$app/forms", () => ({
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
      const result = state.queuedResults.shift();
      if (!result) return;
      const callback = submit?.();
      if (!callback) return;
      await callback({
        result,
        update: async () => {
          if (state.hangUpdate) {
            // Never resolves: the toast assertion must hold without this settling.
            await new Promise<void>(() => {});
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
  invalidateAll: mocks.invalidateAll,
}));

vi.mock("$app/state", () => ({
  page: {
    data: { user: { isActive: true } },
  },
}));

vi.mock("svelte-sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

vi.mock("$lib/state/user-session.svelte", () => ({
  userSession: { plexUsername: "testuser" },
}));

const automaticData = {
  authenticated: true as const,
  mode: "automatic" as const,
  xcUrl: "https://tv.example.com/xc",
  playerApiUrl: "https://tv.example.com/player_api.php",
  xmltvUrl: "https://tv.example.com/xmltv.php",
  platformUrls: [],
  dispatcharrUsername: "testuser",
};

async function openRefreshDialog() {
  render(PortalPage, { props: { data: automaticData } });
  await fireEvent.click(screen.getByRole("button", { name: /Refresh Credentials/ }));
  const dialog = await screen.findByRole("dialog");
  const form = dialog.querySelector<HTMLFormElement>('form[action="?/refreshCredentials"]');
  if (!form) throw new Error("Refresh form not found");
  return { dialog, form };
}

describe("portal credential refresh toast ordering (ISSUE-004)", () => {
  beforeEach(() => {
    state.queuedResults = [];
    state.hangUpdate = false;
    mocks.applyAction.mockClear();
    mocks.invalidateAll.mockClear();
    mocks.toastSuccess.mockClear();
    mocks.toastError.mockClear();
  });

  it("fires the success toast before awaiting update() (not gated behind the reload)", async () => {
    const { form } = await openRefreshDialog();

    state.hangUpdate = true;
    state.queuedResults.push({ type: "success" });
    void fireEvent.submit(form);

    // update() hangs forever, yet the toast still fires — proving it is not
    // gated behind invalidateAll.
    await waitFor(() => {
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Credentials refreshed.");
    });
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("fires the error toast before awaiting update() on a failed refresh", async () => {
    const { form } = await openRefreshDialog();

    state.hangUpdate = true;
    state.queuedResults.push({ type: "failure", data: { error: "refresh_failed" } });
    void fireEvent.submit(form);

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith("Couldn't refresh credentials. Try again.");
    });
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
});
