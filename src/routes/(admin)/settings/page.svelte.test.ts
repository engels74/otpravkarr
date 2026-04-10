import { fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

type MockActionResult = {
  type: "success" | "failure" | "error";
  data?: { message?: string; error?: string };
  error?: Error;
};

const state = vi.hoisted(() => ({
  queuedResults: [] as MockActionResult[],
}));

const mocks = vi.hoisted(() => ({
  applyAction: vi.fn(async () => undefined),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("$app/forms", () => ({
  enhance: (
    node: HTMLFormElement,
    submit?: () =>
      | ((args: { result: MockActionResult; update: () => Promise<void> }) => Promise<void>)
      | void,
  ) => {
    const onSubmit = async (event: Event) => {
      event.preventDefault();
      const callback = submit?.();
      const result = state.queuedResults.shift();
      if (!callback || !result) return;
      await callback({ result, update: async () => undefined });
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

vi.mock("svelte-sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

const defaultData = {
  plex: {
    serverUrl: "http://plex.local",
    hasToken: true,
    machineId: "machine-id",
  },
  dispatcharr: {
    url: "http://dispatcharr.local",
    hasApiKey: true,
    externalUrl: "https://external.example.com",
  },
  sync: {
    intervalMinutes: "15",
  },
  security: {
    allowedOrigins: "",
  },
  audit: {
    retentionDays: "90",
  },
};

describe("admin settings page", () => {
  beforeEach(() => {
    state.queuedResults = [];
    mocks.applyAction.mockClear();
    mocks.toastSuccess.mockClear();
    mocks.toastError.mockClear();
  });

  it("renders external URL input with correct value", async () => {
    const { default: SettingsPage } = await import("./+page.svelte");

    const { container } = render(SettingsPage, { props: { data: defaultData } });
    const externalUrlInput = container.querySelector<HTMLInputElement>("#dispatcharr_external_url");
    if (!externalUrlInput) throw new Error("External URL input not found");

    expect(externalUrlInput.value).toBe("https://external.example.com");
  });

  it("clears stale Plex errors on server URL correction and shows updated success state", async () => {
    const { default: SettingsPage } = await import("./+page.svelte");

    state.queuedResults.push({
      type: "failure",
      data: { error: "Plex token and server URL are required" },
    });
    state.queuedResults.push({
      type: "success",
      data: { message: "Plex settings saved." },
    });

    const { container } = render(SettingsPage, { props: { data: defaultData } });
    const plexForm = container.querySelector<HTMLFormElement>(
      'form[action="?/updatePlexConnection"]',
    );
    if (!plexForm) throw new Error("Plex form not found");

    await fireEvent.submit(plexForm);
    expect(screen.getByText("Plex token and server URL are required")).toBeTruthy();

    const serverUrlInput = container.querySelector<HTMLInputElement>("#plex_server_url");
    if (!serverUrlInput) throw new Error("Plex server URL input not found");
    await fireEvent.input(serverUrlInput, { target: { value: "http://plex.fixed.local" } });
    expect(screen.queryByText("Plex token and server URL are required")).toBeNull();

    await fireEvent.submit(plexForm);
    expect(screen.getByText("Plex settings saved.")).toBeTruthy();
    expect(screen.queryByText("Plex token and server URL are required")).toBeNull();
  });
});
