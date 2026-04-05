import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import QRCodeDisplay from "$lib/components/QRCodeDisplay.svelte";

describe("QRCodeDisplay", () => {
  const DATA_URI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

  it("renders an img element with src=dataUri", () => {
    render(QRCodeDisplay, { props: { dataUri: DATA_URI } });
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", DATA_URI);
  });

  it("has default alt text of 'QR Code'", () => {
    render(QRCodeDisplay, { props: { dataUri: DATA_URI } });
    expect(screen.getByAltText("QR Code")).toBeInTheDocument();
  });

  it("uses custom alt text when provided", () => {
    render(QRCodeDisplay, { props: { dataUri: DATA_URI, alt: "Scan me" } });
    expect(screen.getByAltText("Scan me")).toBeInTheDocument();
  });

  it("applies size to width and height attributes", () => {
    render(QRCodeDisplay, { props: { dataUri: DATA_URI, size: 300 } });
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("width", "300");
    expect(img).toHaveAttribute("height", "300");
  });

  it("uses default size of 200", () => {
    render(QRCodeDisplay, { props: { dataUri: DATA_URI } });
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("width", "200");
    expect(img).toHaveAttribute("height", "200");
  });
});
