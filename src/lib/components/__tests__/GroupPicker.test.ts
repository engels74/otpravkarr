import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import GroupPicker from "../GroupPicker.svelte";

// ISSUE-003: at mobile width the Change Group dialog clipped its action buttons
// and per-group labels. The action button group must be allowed to wrap and the
// channel count must stay legible (shrink-0) instead of being truncated.

const groups = [
  { id: 1, name: "Sports", channelCount: 3 },
  { id: 2, name: "News", channelCount: 0 },
];

describe("GroupPicker responsive layout (ISSUE-003)", () => {
  it("lets the Select/Clear action buttons wrap at narrow widths", () => {
    render(GroupPicker, { props: { groups, selected: new Set<number>() } });
    const selectButton = screen.getByRole("button", { name: "Select all" });
    const actionGroup = selectButton.parentElement;
    expect(actionGroup?.className).toContain("flex-wrap");
  });

  it("keeps the per-group channel count from being clipped", () => {
    render(GroupPicker, { props: { groups, selected: new Set<number>() } });
    const count = screen.getByText("0 channels");
    expect(count.className).toContain("shrink-0");
  });
});
