import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock ofetch
// ---------------------------------------------------------------------------

const mockOfetch = vi.fn();

vi.mock("ofetch", () => ({
  ofetch: (...args: unknown[]) => mockOfetch(...args),
}));

// Import after mocking
const { DispatcharrClient } = await import("../client");
const { createChannelEndpoints } = await import("../endpoints/channels");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createClient() {
  return new DispatcharrClient("https://dispatch.example.com", "test-key");
}

function makePaginatedResponse<T>(
  results: T[],
  next: string | null = null,
  previous: string | null = null,
  count?: number,
) {
  return {
    count: count ?? results.length,
    next,
    previous,
    results,
  };
}

function makeFetchError(statusCode: number, message = "Error") {
  const err = new Error(message) as Error & {
    statusCode: number;
    statusMessage: string;
  };
  err.statusCode = statusCode;
  err.statusMessage = message;
  return err;
}

const CHANNEL_A = { id: 1, name: "HBO", channel_number: 101 };
const CHANNEL_B = { id: 2, name: "ESPN", channel_number: 102 };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockOfetch.mockReset();
});

describe("listChannels", () => {
  it("fetches first page with no arguments", async () => {
    mockOfetch.mockResolvedValueOnce(makePaginatedResponse([CHANNEL_A]));
    const endpoints = createChannelEndpoints(createClient());

    const result = await endpoints.listChannels();

    expect(result).toEqual({
      ok: true,
      data: makePaginatedResponse([CHANNEL_A]),
    });
    expect(mockOfetch).toHaveBeenCalledWith(
      "https://dispatch.example.com/api/channels/channels/",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("passes page and pageSize as query parameters", async () => {
    mockOfetch.mockResolvedValueOnce(makePaginatedResponse([CHANNEL_B]));
    const endpoints = createChannelEndpoints(createClient());

    await endpoints.listChannels(2, 50);

    expect(mockOfetch).toHaveBeenCalledWith(
      "https://dispatch.example.com/api/channels/channels/?page=2&page_size=50",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("validates response with Zod schema", async () => {
    mockOfetch.mockResolvedValueOnce(makePaginatedResponse([{ id: "bad", name: 123 }]));
    const endpoints = createChannelEndpoints(createClient());

    const result = await endpoints.listChannels();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("unexpected_shape");
    }
  });

  it("returns error on auth failure", async () => {
    mockOfetch.mockRejectedValueOnce(makeFetchError(401, "Unauthorized"));
    const endpoints = createChannelEndpoints(createClient());

    const result = await endpoints.listChannels();

    expect(result).toEqual({
      ok: false,
      error: "auth_failure",
      message: "Unauthorized",
    });
  });
});

describe("getAllChannels", () => {
  it("collects all channels across pages", async () => {
    mockOfetch
      .mockResolvedValueOnce(
        makePaginatedResponse(
          [CHANNEL_A],
          "https://dispatch.example.com/api/channels/channels/?page=2",
          null,
          2,
        ),
      )
      .mockResolvedValueOnce(makePaginatedResponse([CHANNEL_B], null, null, 2));

    const endpoints = createChannelEndpoints(createClient());
    const result = await endpoints.getAllChannels();

    expect(result).toEqual({
      ok: true,
      data: [CHANNEL_A, CHANNEL_B],
    });
  });

  it("returns empty array when no channels exist", async () => {
    mockOfetch.mockResolvedValueOnce(makePaginatedResponse([], null, null, 0));
    const endpoints = createChannelEndpoints(createClient());

    const result = await endpoints.getAllChannels();

    expect(result).toEqual({ ok: true, data: [] });
  });

  it("returns error when pagination fails", async () => {
    mockOfetch.mockRejectedValueOnce(makeFetchError(401, "Unauthorized"));
    const endpoints = createChannelEndpoints(createClient());

    const result = await endpoints.getAllChannels();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("auth_failure");
    }
  });

  it("handles flat array response from channels API", async () => {
    mockOfetch.mockResolvedValueOnce([CHANNEL_A, CHANNEL_B]);
    const endpoints = createChannelEndpoints(createClient());

    const result = await endpoints.getAllChannels();

    expect(result).toEqual({
      ok: true,
      data: [CHANNEL_A, CHANNEL_B],
    });
    expect(mockOfetch).toHaveBeenCalledTimes(1);
  });
});

describe("getChannelStreams", () => {
  it("fetches streams for a channel", async () => {
    const streams = [
      { id: 10, name: "Stream 1" },
      { id: 11, name: "Stream 2" },
    ];
    mockOfetch.mockResolvedValueOnce(streams);
    const endpoints = createChannelEndpoints(createClient());

    const result = await endpoints.getChannelStreams(1);

    expect(result).toEqual({ ok: true, data: streams });
    expect(mockOfetch).toHaveBeenCalledWith(
      "https://dispatch.example.com/api/channels/channels/1/streams/",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns empty array when channel has no streams", async () => {
    mockOfetch.mockResolvedValueOnce([]);
    const endpoints = createChannelEndpoints(createClient());

    const result = await endpoints.getChannelStreams(99);

    expect(result).toEqual({ ok: true, data: [] });
  });

  it("returns error on network failure", async () => {
    mockOfetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const endpoints = createChannelEndpoints(createClient());

    const result = await endpoints.getChannelStreams(1);

    expect(result).toEqual({
      ok: false,
      error: "network_error",
      message: "ECONNREFUSED",
    });
  });
});
