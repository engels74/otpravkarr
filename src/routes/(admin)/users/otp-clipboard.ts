export async function copyOtpToClipboard(value: string): Promise<"copied" | "failed"> {
  try {
    await navigator.clipboard.writeText(value);
    return "copied";
  } catch {
    return "failed";
  }
}
