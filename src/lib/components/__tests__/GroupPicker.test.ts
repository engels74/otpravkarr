import { fireEvent, render, screen } from "@testing-library/svelte";
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

  // ISSUE-004: `flex-1` alone leaves min-width:auto, so a long name can't shrink
  // below its content and `truncate` never engages (overflowing the dialog at
  // 390px). `min-w-0` is the effective fix; assert it alongside `truncate`.
  it("lets long group names truncate via min-w-0", () => {
    render(GroupPicker, { props: { groups, selected: new Set<number>() } });
    const nameSpan = screen.getByText("Sports");
    expect(nameSpan.className).toContain("min-w-0");
    expect(nameSpan.className).toContain("truncate");
  });
});

// ISSUE-002: the picker rendered one native checkbox per group ahead of Save,
// so ~300 groups meant ~300 Tab stops before the Save button. A roving tabindex
// makes the list a single tab stop with Arrow-key navigation.
const manyGroups = [
  { id: 1, name: "Sports", channelCount: 3 },
  { id: 2, name: "News", channelCount: 0 },
  { id: 3, name: "Movies", channelCount: 12 },
  { id: 4, name: "Kids", channelCount: 5 },
];

const tabindexes = () =>
  screen.getAllByRole("checkbox").map((cb) => (cb as HTMLInputElement).getAttribute("tabindex"));

describe("GroupPicker roving tabindex (ISSUE-002)", () => {
  it("exposes exactly one tab stop (the first row) across the whole list", () => {
    render(GroupPicker, { props: { groups: manyGroups, selected: new Set<number>() } });
    expect(tabindexes()).toEqual(["0", "-1", "-1", "-1"]);
  });

  it("moves the active row with ArrowDown / ArrowUp and keeps one tab stop", async () => {
    render(GroupPicker, { props: { groups: manyGroups, selected: new Set<number>() } });
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];

    checkboxes[0]?.focus();
    await fireEvent.keyDown(checkboxes[0] as HTMLElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(checkboxes[1]);
    expect(tabindexes()).toEqual(["-1", "0", "-1", "-1"]);

    await fireEvent.keyDown(checkboxes[1] as HTMLElement, { key: "ArrowUp" });
    expect(document.activeElement).toBe(checkboxes[0]);
    expect(tabindexes()).toEqual(["0", "-1", "-1", "-1"]);
  });

  it("does not run past the ends of the list", async () => {
    render(GroupPicker, { props: { groups: manyGroups, selected: new Set<number>() } });
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];

    checkboxes[0]?.focus();
    await fireEvent.keyDown(checkboxes[0] as HTMLElement, { key: "ArrowUp" });
    expect(document.activeElement).toBe(checkboxes[0]);

    await fireEvent.keyDown(checkboxes[0] as HTMLElement, { key: "End" });
    expect(document.activeElement).toBe(checkboxes[3]);
    await fireEvent.keyDown(checkboxes[3] as HTMLElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(checkboxes[3]);
  });

  it("toggles the active row with Enter and preserves the selection", async () => {
    render(GroupPicker, { props: { groups: manyGroups, selected: new Set<number>() } });
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];

    checkboxes[0]?.focus();
    await fireEvent.keyDown(checkboxes[0] as HTMLElement, { key: "ArrowDown" });
    expect(checkboxes[1]?.checked).toBe(false);
    await fireEvent.keyDown(checkboxes[1] as HTMLElement, { key: "Enter" });
    expect(checkboxes[1]?.checked).toBe(true);
    // Other rows are untouched.
    expect(checkboxes[0]?.checked).toBe(false);
    expect(checkboxes[2]?.checked).toBe(false);
  });

  it("toggles on click via the native change handler", async () => {
    render(GroupPicker, { props: { groups: manyGroups, selected: new Set<number>() } });
    const checkbox = screen.getAllByRole("checkbox")[0] as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    await fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
  });

  it("keeps Select-all / Clear-all working", async () => {
    render(GroupPicker, { props: { groups: manyGroups, selected: new Set<number>() } });

    await fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    for (const cb of screen.getAllByRole("checkbox") as HTMLInputElement[]) {
      expect(cb.checked).toBe(true);
    }

    await fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    for (const cb of screen.getAllByRole("checkbox") as HTMLInputElement[]) {
      expect(cb.checked).toBe(false);
    }
  });

  it("resets the active row to the first visible row when a search filters it out", async () => {
    render(GroupPicker, { props: { groups: manyGroups, selected: new Set<number>() } });
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];

    // Move the active row to index 2 (Movies).
    checkboxes[0]?.focus();
    await fireEvent.keyDown(checkboxes[0] as HTMLElement, { key: "ArrowDown" });
    await fireEvent.keyDown(checkboxes[1] as HTMLElement, { key: "ArrowDown" });
    expect(tabindexes()).toEqual(["-1", "-1", "0", "-1"]);

    // Narrow the list so the previously active row (Movies) is gone.
    const search = screen.getByRole("searchbox");
    await fireEvent.input(search, { target: { value: "news" } });

    // Exactly one visible row remains and it is the tab stop — no focus trap.
    expect(tabindexes()).toEqual(["0"]);
    expect(screen.getByText("News")).toBeTruthy();
  });

  it("renders a non-interactive disabled picker (public disabled prop preserved)", () => {
    render(GroupPicker, {
      props: { groups: manyGroups, selected: new Set<number>(), disabled: true },
    });
    for (const cb of screen.getAllByRole("checkbox") as HTMLInputElement[]) {
      expect(cb.disabled).toBe(true);
    }
    expect(screen.queryByRole("button", { name: /Select/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Clear/ })).toBeNull();
  });
});
