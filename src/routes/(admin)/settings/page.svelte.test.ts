import { fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "./+page.svelte";

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
      // Mirror SvelteKit's real update(): reset the submitting form unless the
      // caller opts out with { reset: false }. This is what makes the ISSUE-008
      // assertions (origins retained vs secrets cleared) meaningful.
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
  subscription: {
    allowSelfSelect: true,
    selectableGroupIds: [],
    channelGroups: [],
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
    const { container } = render(SettingsPage, { props: { data: defaultData } });
    const externalUrlInput = container.querySelector<HTMLInputElement>("#dispatcharr_external_url");
    if (!externalUrlInput) throw new Error("External URL input not found");

    expect(externalUrlInput.value).toBe("https://external.example.com");
  });

  it("wraps long Machine ID inside the Plex card on narrow viewports", async () => {
    const longMachineId = "abcdef0123456789".repeat(4);
    const { container } = render(SettingsPage, {
      props: {
        data: { ...defaultData, plex: { ...defaultData.plex, machineId: longMachineId } },
      },
    });

    const machineIdValue = Array.from(container.querySelectorAll("p")).find(
      (el) => el.textContent === longMachineId,
    );
    if (!machineIdValue) throw new Error("Machine ID value not found");

    expect(machineIdValue.className).toContain("break-all");
    expect(machineIdValue.className).toContain("min-w-0");
  });

  it("clears stale Plex errors on server URL correction and shows updated success state", async () => {
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

  it("renders section-specific accessible names for save buttons", async () => {
    render(SettingsPage, { props: { data: defaultData } });

    expect(screen.getByRole("button", { name: "Save Plex settings" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save Dispatcharr settings" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save sync settings" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save security settings" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save audit retention settings" })).toBeTruthy();
  });

  it("shows sync interval validation inline and ties it to the input", async () => {
    state.queuedResults.push({
      type: "failure",
      data: { error: "Sync interval must be a number between 1 and 1440" },
    });

    const { container } = render(SettingsPage, { props: { data: defaultData } });
    const syncForm = container.querySelector<HTMLFormElement>(
      'form[action="?/updateSyncSettings"]',
    );
    if (!syncForm) throw new Error("Sync form not found");

    await fireEvent.submit(syncForm);

    const syncInput = screen.getByLabelText("Sync interval");
    const error = screen.getByText("Sync interval must be a number between 1 and 1440");
    expect(error).toBeTruthy();
    expect(syncInput.getAttribute("aria-invalid")).toBe("true");
    expect(syncInput.getAttribute("aria-describedby")).toBe(error.id);
  });

  it("keeps the Allowed Origins textarea populated after a successful save (ISSUE-008)", async () => {
    state.queuedResults.push({
      type: "success",
      data: { message: "Security settings saved." },
    });

    const { container } = render(SettingsPage, { props: { data: defaultData } });
    const textarea = container.querySelector<HTMLTextAreaElement>("#allowed_origins");
    if (!textarea) throw new Error("Allowed origins textarea not found");

    await fireEvent.input(textarea, { target: { value: "https://app.example.com" } });

    const securityForm = container.querySelector<HTMLFormElement>(
      'form[action="?/updateSecurity"]',
    );
    if (!securityForm) throw new Error("Security form not found");

    await fireEvent.submit(securityForm);

    // reset:false → the uncontrolled textarea keeps the saved value instead of
    // being blanked by form.reset().
    expect(textarea.value).toBe("https://app.example.com");
  });

  it("clears the Plex token field after a successful save (ISSUE-008 inverse)", async () => {
    state.queuedResults.push({
      type: "success",
      data: { message: "Plex settings saved." },
    });

    const { container } = render(SettingsPage, { props: { data: defaultData } });
    const tokenInput = container.querySelector<HTMLInputElement>("#plex_admin_token");
    if (!tokenInput) throw new Error("Plex token input not found");

    await fireEvent.input(tokenInput, { target: { value: "super-secret-plex-token" } });

    const plexForm = container.querySelector<HTMLFormElement>(
      'form[action="?/updatePlexConnection"]',
    );
    if (!plexForm) throw new Error("Plex form not found");

    await fireEvent.submit(plexForm);

    // The "leave blank to keep current" secret field must NOT linger in the DOM.
    expect(tokenInput.value).toBe("");
  });

  it("clears the Dispatcharr API key field after a successful save (ISSUE-008 inverse)", async () => {
    state.queuedResults.push({
      type: "success",
      data: { message: "Dispatcharr settings saved." },
    });

    const { container } = render(SettingsPage, { props: { data: defaultData } });
    const apiKeyInput = container.querySelector<HTMLInputElement>("#dispatcharr_api_key");
    if (!apiKeyInput) throw new Error("Dispatcharr API key input not found");

    await fireEvent.input(apiKeyInput, { target: { value: "super-secret-api-key" } });

    const dispatcharrForm = container.querySelector<HTMLFormElement>(
      'form[action="?/updateDispatcharrConnection"]',
    );
    if (!dispatcharrForm) throw new Error("Dispatcharr form not found");

    await fireEvent.submit(dispatcharrForm);

    expect(apiKeyInput.value).toBe("");
  });

  it("keeps the self-select checkbox toggled after a successful save (ISSUE-001)", async () => {
    state.queuedResults.push({
      type: "success",
      data: { message: "Settings saved successfully." },
    });

    // Start from the unchecked default so a stray form.reset() would visibly
    // revert the toggle (defaultChecked === false), making this discriminating.
    const { container } = render(SettingsPage, {
      props: {
        data: {
          ...defaultData,
          subscription: { ...defaultData.subscription, allowSelfSelect: false },
        },
      },
    });
    const subscriptionForm = container.querySelector<HTMLFormElement>(
      'form[action="?/updateDefaultProvisioning"]',
    );
    if (!subscriptionForm) throw new Error("Subscription form not found");
    const checkbox = subscriptionForm.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!checkbox) throw new Error("Self-select checkbox not found");

    await fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    await fireEvent.submit(subscriptionForm);

    // reset:false → the just-toggled checkbox keeps the saved value instead of
    // being reverted to its unchecked HTML default by form.reset().
    expect(checkbox.checked).toBe(true);
  });
});
