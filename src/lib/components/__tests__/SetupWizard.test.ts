import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import SetupWizard from "$lib/components/SetupWizard.svelte";

const STEPS = ["Claim", "Admin", "Plex", "Dispatcharr"] as const;

describe("SetupWizard", () => {
  it("renders all step labels", () => {
    render(SetupWizard, { props: { steps: STEPS, currentStep: 0 } });
    for (const step of STEPS) {
      expect(screen.getByText(step)).toBeInTheDocument();
    }
  });

  it("renders step numbers for future and current steps", () => {
    render(SetupWizard, { props: { steps: STEPS, currentStep: 1 } });
    // Step 1 (index 0) is completed → checkmark, no number
    // Step 2 (index 1) is current → shows "2"
    expect(screen.getByText("2")).toBeInTheDocument();
    // Step 3 (index 2) is future → shows "3"
    expect(screen.getByText("3")).toBeInTheDocument();
    // Step 4 (index 3) is future → shows "4"
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("shows checkmark SVG for completed steps", () => {
    const { container } = render(SetupWizard, {
      props: { steps: STEPS, currentStep: 2 },
    });
    // Steps 0 and 1 are completed, should have checkmark SVGs
    const checkmarks = container.querySelectorAll("svg[aria-hidden='true']");
    expect(checkmarks.length).toBe(2);
  });

  it("marks current step with aria-current='step'", () => {
    const { container } = render(SetupWizard, {
      props: { steps: STEPS, currentStep: 1 },
    });
    const currentIndicator = container.querySelector("[aria-current='step']");
    expect(currentIndicator).toBeInTheDocument();
  });

  it("renders the correct number of step indicators", () => {
    const { container } = render(SetupWizard, {
      props: { steps: STEPS, currentStep: 0 },
    });
    const listItems = container.querySelectorAll("li");
    expect(listItems.length).toBe(STEPS.length);
  });

  it("does not show aria-current on non-current steps", () => {
    const { container } = render(SetupWizard, {
      props: { steps: STEPS, currentStep: 0 },
    });
    const allAriaCurrent = container.querySelectorAll("[aria-current='step']");
    expect(allAriaCurrent.length).toBe(1);
  });
});
