import { describe, expect, it, vi } from "vitest";

import { generateQRCodeDataUri, QRCodeError } from "../../utils/qrcode";

// ---------------------------------------------------------------------------
// generateQRCodeDataUri
// ---------------------------------------------------------------------------

describe("generateQRCodeDataUri", () => {
  it("generates a data URI starting with data:image/png;base64,", async () => {
    const uri = await generateQRCodeDataUri("https://example.com");

    expect(uri).toMatch(/^data:image\/png;base64,/);
  });

  it("accepts custom size, margin, and error correction options", async () => {
    const uri = await generateQRCodeDataUri("https://example.com", {
      size: 512,
      margin: 4,
      errorCorrectionLevel: "H",
    });

    expect(uri).toMatch(/^data:image\/png;base64,/);
    // A larger size should produce a longer base64 payload
    const defaultUri = await generateQRCodeDataUri("https://example.com");
    expect(uri.length).toBeGreaterThan(defaultUri.length);
  });

  it("uses default options when none are provided", async () => {
    const uri = await generateQRCodeDataUri("hello");

    expect(typeof uri).toBe("string");
    expect(uri).toMatch(/^data:image\/png;base64,/);
  });

  it("throws QRCodeError for an empty string input", async () => {
    await expect(generateQRCodeDataUri("")).rejects.toThrow(QRCodeError);
  });

  it("calls the qrcode library with correct parameters", async () => {
    const QRCode = await import("qrcode");
    const spy = vi.spyOn(QRCode.default, "toDataURL");

    await generateQRCodeDataUri("test-text", {
      size: 128,
      margin: 1,
      errorCorrectionLevel: "Q",
    });

    expect(spy).toHaveBeenCalledWith(
      "test-text",
      expect.objectContaining({
        width: 128,
        margin: 1,
        errorCorrectionLevel: "Q",
      }),
    );

    spy.mockRestore();
  });

  it("wraps library errors in QRCodeError", async () => {
    const QRCode = await import("qrcode");
    const spy = vi
      .spyOn(QRCode.default, "toDataURL")
      .mockRejectedValueOnce(new Error("encoding failed"));

    await expect(generateQRCodeDataUri("x")).rejects.toThrow(QRCodeError);
    await expect(generateQRCodeDataUri("x")).resolves.toMatch(/^data:image\/png;base64,/);

    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// QRCodeError
// ---------------------------------------------------------------------------

describe("QRCodeError", () => {
  it("is an instance of Error", () => {
    const err = new QRCodeError("test");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(QRCodeError);
  });

  it("has the correct name and message", () => {
    const err = new QRCodeError("something went wrong");
    expect(err.name).toBe("QRCodeError");
    expect(err.message).toBe("something went wrong");
  });
});
