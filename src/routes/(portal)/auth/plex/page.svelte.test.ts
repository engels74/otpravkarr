import { render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import AuthPlexPage from "./+page.svelte";

const pickerData = {
  picker: true,
  plexUsername: "plexfriend",
  offered: [
    { id: 1, name: "News", channelCount: 10 },
    { id: 2, name: "Sports", channelCount: 20 },
    { id: 3, name: "Kids", channelCount: 5 },
  ],
  selected: [1],
};

describe("Plex onboarding picker retry state", () => {
  it("renders the submitted selection from action data after a retryable failure", () => {
    const { container, getByText } = render(AuthPlexPage, {
      props: {
        data: pickerData,
        form: {
          error: "Unable to set up your account. Please try again.",
          selected: [2, 3],
        },
      },
    });

    expect(getByText("Unable to set up your account. Please try again.")).toBeTruthy();
    expect(getByText("2 selected · 3 available")).toBeTruthy();

    const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect([...checkboxes].map((checkbox) => checkbox.checked)).toEqual([false, true, true]);

    const selectedInput = container.querySelector<HTMLInputElement>('input[name="group_ids"]');
    expect(selectedInput?.value).toBe("[2,3]");
  });
});
