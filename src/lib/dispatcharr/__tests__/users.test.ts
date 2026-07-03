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
const { listUsers, findUserByUsername, createUser, getUser, updateUser, deleteUser } = await import(
  "../endpoints/users"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createClient() {
  return new DispatcharrClient("https://dispatch.example.com", "test-key");
}

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    username: "testuser",
    email: "test@example.com",
    is_staff: false,
    is_superuser: false,
    ...overrides,
  };
}

function makePaginatedResponse(results: unknown[], count?: number) {
  return {
    count: count ?? results.length,
    next: null,
    previous: null,
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockOfetch.mockReset();
});

describe("listUsers", () => {
  it("handles paginated response without params", async () => {
    const user = makeUser();
    mockOfetch.mockResolvedValueOnce(makePaginatedResponse([user]));
    const client = createClient();

    const result = await listUsers(client);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toEqual([user]);
      expect(result.data.count).toBe(1);
    }
    expect(mockOfetch).toHaveBeenCalledWith(
      "https://dispatch.example.com/api/accounts/users/",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("handles flat array response without params", async () => {
    const user = makeUser();
    mockOfetch.mockResolvedValueOnce([user]);
    const client = createClient();

    const result = await listUsers(client);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toEqual([user]);
      expect(result.data.count).toBe(1);
      expect(result.data.next).toBeNull();
      expect(result.data.previous).toBeNull();
    }
  });

  it("passes page and pageSize as query params", async () => {
    mockOfetch.mockResolvedValueOnce(makePaginatedResponse([]));
    const client = createClient();

    await listUsers(client, 2, 25);

    expect(mockOfetch).toHaveBeenCalledWith(
      "https://dispatch.example.com/api/accounts/users/?page=2&page_size=25",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("normalizes flat array responses even when query params are present", async () => {
    const user = makeUser({ username: "alice" });
    mockOfetch.mockResolvedValueOnce([user]);
    const client = createClient();

    const result = await listUsers(client, 1, 100);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toEqual([user]);
      expect(result.data.count).toBe(1);
    }
  });

  it("finds an exact user from Dispatcharr username search results", async () => {
    const user = makeUser({ username: "alice" });
    mockOfetch.mockResolvedValueOnce([makeUser({ username: "alice_2" }), user]);
    const client = createClient();

    const result = await findUserByUsername(client, "alice");

    expect(result).toEqual({ ok: true, data: user });
    expect(mockOfetch).toHaveBeenCalledWith(
      "https://dispatch.example.com/api/accounts/users/?username=alice&page_size=100",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns error on auth failure", async () => {
    mockOfetch.mockRejectedValueOnce(makeFetchError(401, "Unauthorized"));
    const client = createClient();

    const result = await listUsers(client);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("auth_failure");
    }
  });

  it("returns unexpected_shape when response misses required fields", async () => {
    mockOfetch.mockResolvedValueOnce({ bad: "data" });
    const client = createClient();

    const result = await listUsers(client);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("unexpected_shape");
    }
  });
});

describe("createUser", () => {
  it("creates a user with required fields", async () => {
    const user = makeUser();
    mockOfetch.mockResolvedValueOnce(user);
    const client = createClient();

    const result = await createUser(client, {
      username: "testuser",
      password: "secret123",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(user);
    }
    expect(mockOfetch).toHaveBeenCalledWith(
      "https://dispatch.example.com/api/accounts/users/",
      expect.objectContaining({
        method: "POST",
        body: { username: "testuser", password: "secret123" },
      }),
    );
  });

  it("creates a user with all optional fields", async () => {
    const user = makeUser({ is_staff: true });
    mockOfetch.mockResolvedValueOnce(user);
    const client = createClient();

    const data = {
      username: "admin",
      password: "pass",
      email: "admin@example.com",
      is_staff: true,
    };

    const result = await createUser(client, data);

    expect(result.ok).toBe(true);
    expect(mockOfetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: data }),
    );
  });

  it("accepts create response with extra API fields via passthrough", async () => {
    mockOfetch.mockResolvedValueOnce({
      id: 10,
      username: "newuser",
      email: "new@test.com",
      is_staff: false,
      api_key: "abc123",
      user_level: 0,
      channel_profiles: [1],
      stream_limit: 1,
    });
    const client = createClient();

    const result = await createUser(client, { username: "newuser", password: "pass" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe(10);
      expect(result.data.username).toBe("newuser");
    }
  });

  it("validates response schema", async () => {
    mockOfetch.mockResolvedValueOnce({ id: "not-a-number" });
    const client = createClient();

    const result = await createUser(client, {
      username: "u",
      password: "p",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("unexpected_shape");
    }
  });
});

describe("getUser", () => {
  it("fetches a single user by id", async () => {
    const user = makeUser({ id: 42 });
    mockOfetch.mockResolvedValueOnce(user);
    const client = createClient();

    const result = await getUser(client, 42);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe(42);
    }
    expect(mockOfetch).toHaveBeenCalledWith(
      "https://dispatch.example.com/api/accounts/users/42/",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns not_found for missing user", async () => {
    mockOfetch.mockRejectedValueOnce(makeFetchError(404, "Not Found"));
    const client = createClient();

    const result = await getUser(client, 999);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("not_found");
    }
  });
});

describe("updateUser", () => {
  it("updates user fields via PATCH", async () => {
    const user = makeUser({ email: "new@example.com" });
    mockOfetch.mockResolvedValueOnce(user);
    const client = createClient();

    const result = await updateUser(client, 1, { email: "new@example.com" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.email).toBe("new@example.com");
    }
    expect(mockOfetch).toHaveBeenCalledWith(
      "https://dispatch.example.com/api/accounts/users/1/",
      expect.objectContaining({
        method: "PATCH",
        body: { email: "new@example.com" },
      }),
    );
  });

  it("validates response schema on update", async () => {
    mockOfetch.mockResolvedValueOnce({ invalid: true });
    const client = createClient();

    const result = await updateUser(client, 1, { email: "new@test.com" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("unexpected_shape");
    }
  });
});

describe("deleteUser", () => {
  it("deletes a user by id", async () => {
    mockOfetch.mockResolvedValueOnce(undefined);
    const client = createClient();

    const result = await deleteUser(client, 5);

    expect(result.ok).toBe(true);
    expect(mockOfetch).toHaveBeenCalledWith(
      "https://dispatch.example.com/api/accounts/users/5/",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("returns not_found when user does not exist", async () => {
    mockOfetch.mockRejectedValueOnce(makeFetchError(404, "Not Found"));
    const client = createClient();

    const result = await deleteUser(client, 999);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("not_found");
    }
  });
});
