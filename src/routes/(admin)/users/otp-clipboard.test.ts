import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyOtpToClipboard } from "./otp-clipboard";

describe("copyOtpToClipboard", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(),
      },
    });
  });

  it("returns copied when clipboard write succeeds", async () => {
    vi.mocked(navigator.clipboard.writeText).mockResolvedValueOnce(undefined);

    await expect(copyOtpToClipboard("secret-password")).resolves.toBe("copied");
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("secret-password");
  });

  it("returns failed when clipboard write rejects", async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error("NotAllowedError"));

    await expect(copyOtpToClipboard("secret-password")).resolves.toBe("failed");
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("secret-password");
  });
});
