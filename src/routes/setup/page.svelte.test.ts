import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SetupPage from "./+page.svelte";

type MockActionResult = {
  type: "success" | "failure" | "error";
  data?: Record<string, unknown>;
  error?: Error;
};

const state = vi.hoisted(() => ({
  queuedResults: [] as MockActionResult[],
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
      const result = state.queuedResults.shift();
      if (!result) return;
      const callback = submit?.();
      if (!callback) return;
      await callback({ result, update: async () => undefined });
    };
    node.addEventListener("submit", onSubmit);
    return {
      destroy() {
        node.removeEventListener("submit", onSubmit);
      },
    };
  },
}));

const dispatcharrStepData = {
  claimActive: true,
  resumePhase: 3 as const,
  dispatcharrGroups: [] as Array<{ id: number; name: string }>,
  dispatcharrProfiles: [] as Array<{ id: number; name: string }>,
  oauthCallback: false,
  adminPresent: true,
  recoveryAvailable: false,
  claimHeldElsewhere: false,
  claimRetryAt: null,
};

describe("setup wizard Dispatcharr step (ISSUE-003)", () => {
  beforeEach(() => {
    state.queuedResults = [];
  });

  it("preserves the Dispatcharr fields when navigating forward to Origin then Back", async () => {
    const { container } = render(SetupPage, { props: { data: dispatcharrStepData } });

    const url = () => container.querySelector<HTMLInputElement>("#dispatcharr-url");
    const external = () => container.querySelector<HTMLInputElement>("#dispatcharr-external-url");
    const key = () => container.querySelector<HTMLInputElement>("#dispatcharr-key");

    // Starts on the Dispatcharr step with empty (uncontrolled would-be-lost) inputs.
    const urlInput = url();
    const externalInput = external();
    const keyInput = key();
    if (!urlInput || !externalInput || !keyInput) throw new Error("Dispatcharr inputs not found");

    await fireEvent.input(urlInput, { target: { value: "http://localhost:5001" } });
    await fireEvent.input(externalInput, { target: { value: "https://tv.example.com" } });
    await fireEvent.input(keyInput, { target: { value: "super-secret-key" } });

    // Advance to the Origin step (server-action success drives step 3 → 4).
    const dispatcharrForm = container.querySelector<HTMLFormElement>(
      'form[action="?/configureDispatcharr"]',
    );
    if (!dispatcharrForm) throw new Error("Dispatcharr form not found");
    state.queuedResults.push({
      type: "success",
      data: { success: true, groups: [], profiles: [] },
    });
    await fireEvent.submit(dispatcharrForm);

    // On the Origin step now (its form is mounted); the Dispatcharr inputs unmount.
    await waitFor(() => {
      expect(container.querySelector('form[action="?/configureOrigin"]')).not.toBeNull();
    });
    expect(url()).toBeNull();

    // Navigate Back to the Dispatcharr step (client-side step change → remount).
    await fireEvent.click(screen.getByRole("button", { name: "Back" }));

    // The previously typed values must survive the unmount/remount (the fix).
    await waitFor(() => {
      expect(url()?.value).toBe("http://localhost:5001");
    });
    expect(external()?.value).toBe("https://tv.example.com");
    expect(key()?.value).toBe("super-secret-key");
  });
});
