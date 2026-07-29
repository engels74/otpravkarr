import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import QRCodeDisplay from "$lib/components/QRCodeDisplay.svelte";

const { toDataURL } = vi.hoisted(() => ({
  toDataURL: vi.fn(async () => "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="),
}));

vi.mock("qrcode", () => ({ toDataURL }));

describe("QRCodeDisplay", () => {
  beforeEach(() => {
    toDataURL.mockClear();
  });

  it("does not create or render a QR code before explicit user action", () => {
    render(QRCodeDisplay, { props: { value: "https://example.test/credential" } });

    expect(screen.getByRole("button", { name: "Generate QR code" })).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(toDataURL).not.toHaveBeenCalled();
  });

  it("generates the QR code locally after a click", async () => {
    const value = "https://example.test/credential";
    render(QRCodeDisplay, { props: { value } });

    await fireEvent.click(screen.getByRole("button", { name: "Generate QR code" }));

    await waitFor(() => expect(screen.getByRole("img")).toBeInTheDocument());
    expect(toDataURL).toHaveBeenCalledWith(value, { margin: 1, width: 200 });
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
    );
  });

  it("uses custom alt text and dimensions", async () => {
    render(QRCodeDisplay, {
      props: { value: "https://example.test/credential", alt: "Scan me", size: 300 },
    });

    await fireEvent.click(screen.getByRole("button", { name: "Generate QR code" }));

    const img = await screen.findByAltText("Scan me");
    expect(img).toHaveAttribute("width", "300");
    expect(img).toHaveAttribute("height", "300");
    expect(toDataURL).toHaveBeenCalledWith(expect.any(String), { margin: 1, width: 300 });
  });
});
