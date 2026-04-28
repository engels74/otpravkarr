import { fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CopyableField from "$lib/components/CopyableField.svelte";

const mocks = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("svelte-sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

describe("CopyableField", () => {
  beforeEach(() => {
    mocks.toastSuccess.mockClear();
    mocks.toastError.mockClear();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("renders the label text", () => {
    render(CopyableField, { props: { label: "API Key", value: "abc-123" } });
    expect(screen.getByText("API Key")).toBeInTheDocument();
  });

  it("renders the value in a readonly input", () => {
    render(CopyableField, { props: { label: "URL", value: "https://example.com" } });
    const input = screen.getByDisplayValue("https://example.com");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("readonly");
  });

  it("has a copy button", () => {
    render(CopyableField, { props: { label: "Token", value: "tok_123" } });
    expect(screen.getByRole("button", { name: "Copy Token to clipboard" })).toBeInTheDocument();
  });

  it("copies value to clipboard when copy button is clicked", async () => {
    render(CopyableField, { props: { label: "Token", value: "secret-value" } });
    const btn = screen.getByRole("button", { name: "Copy Token to clipboard" });

    await fireEvent.click(btn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("secret-value");
  });

  it("shows success feedback after successful copy", async () => {
    const { container } = render(CopyableField, {
      props: { label: "Token", value: "val" },
    });

    const btn = screen.getByRole("button", { name: "Copy Token to clipboard" });
    await fireEvent.click(btn);

    // After copy, the check icon SVG should be present (lucide-svelte renders SVGs)
    // The CopyIcon is replaced with CheckIcon which has class "text-green-500"
    await vi.waitFor(() => {
      const greenIcon = container.querySelector(
        "svg.text-green-500, [class*='text-green-500'] svg, svg[class*='green']",
      );
      expect(greenIcon).toBeTruthy();
    });
    expect(await screen.findByText("Copied Token to clipboard")).toBeInTheDocument();
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Copied Token to clipboard");
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("shows error feedback when clipboard write fails", async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error("denied")),
      },
    });
    render(CopyableField, {
      props: { label: "Token", value: "secret-value" },
    });

    await fireEvent.click(screen.getByRole("button", { name: "Copy Token to clipboard" }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("secret-value");
    expect(await screen.findByText("Couldn't copy to clipboard")).toBeInTheDocument();
    expect(mocks.toastError).toHaveBeenCalledWith("Couldn't copy to clipboard");
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
});
