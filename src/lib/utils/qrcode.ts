import QRCode from "qrcode";

export class QRCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QRCodeError";
  }
}

export interface QRCodeOptions {
  size?: number;
  margin?: number;
  errorCorrectionLevel?: "L" | "M" | "Q" | "H";
}

export async function generateQRCodeDataUri(
  text: string,
  options?: QRCodeOptions,
): Promise<string> {
  if (!text || !text.trim()) {
    throw new QRCodeError("Input text must not be empty");
  }

  const size = options?.size ?? 256;
  const margin = options?.margin ?? 2;
  const errorCorrectionLevel = options?.errorCorrectionLevel ?? "M";

  try {
    return await QRCode.toDataURL(text, {
      width: size,
      margin,
      errorCorrectionLevel,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new QRCodeError(message);
  }
}
