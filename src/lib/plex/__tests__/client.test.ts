import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock @ctrl/plex
// ---------------------------------------------------------------------------

const mockServerConnect = vi.fn();
const mockAccountConnect = vi.fn();
const mockResources = vi.fn();

vi.mock("@ctrl/plex", () => {
  class PlexServer {
    friendlyName = "";
    machineIdentifier = "";
    version = "";

    constructor(
      public baseurl: string,
      public token: string,
    ) {}

    async connect() {
      return mockServerConnect.call(this);
    }
  }

  class MyPlexAccount {
    token: string;

    constructor(opts?: { token?: string }) {
      this.token = opts?.token ?? "";
    }

    async connect() {
      return mockAccountConnect.call(this);
    }

    async resources() {
      return mockResources.call(this);
    }
  }

  class Unauthorized extends Error {
    override name = "Unauthorized";
    constructor(message = "Unauthorized") {
      super(message);
    }
  }

  class BadRequest extends Error {
    override name = "BadRequest";
    constructor(message = "Bad request") {
      super(message);
    }
  }

  class NotFound extends Error {
    override name = "NotFound";
    constructor(message = "Not found") {
      super(message);
    }
  }

  return { PlexServer, MyPlexAccount, Unauthorized, BadRequest, NotFound };
});

// Import after mocking
const { PlexServer, MyPlexAccount, Unauthorized, BadRequest, NotFound } = await import(
  "@ctrl/plex"
);
const { validateServerToken, checkServerHealth, getAccount, getServerResources, discoverServers } =
  await import("../client");
const { PlexAuthError, PlexConnectionError } = await import("../types");

// Reset mocks to default behaviour before each test
function resetMocks() {
  mockServerConnect.mockReset();
  mockAccountConnect.mockReset();
  mockResources.mockReset();

  mockServerConnect.mockImplementation(async function (this: InstanceType<typeof PlexServer>) {
    return this;
  });
  mockAccountConnect.mockImplementation(async function (this: InstanceType<typeof MyPlexAccount>) {
    return this;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("validateServerToken", () => {
  it("returns PlexServerInfo on success", async () => {
    resetMocks();
    mockServerConnect.mockImplementation(async function (this: InstanceType<typeof PlexServer>) {
      this.friendlyName = "My Plex Server";
      this.machineIdentifier = "abc123";
      this.version = "1.32.0";
      return this;
    });

    const result = await validateServerToken("http://localhost:32400", "valid-token");

    expect(result).toEqual({
      friendlyName: "My Plex Server",
      machineIdentifier: "abc123",
      version: "1.32.0",
    });
  });

  it("throws PlexAuthError on Unauthorized", async () => {
    resetMocks();
    mockServerConnect.mockImplementation(async () => {
      throw new Unauthorized("Unauthorized");
    });

    await expect(validateServerToken("http://localhost:32400", "bad-token")).rejects.toThrow(
      PlexAuthError,
    );
  });

  it("throws PlexConnectionError on network error", async () => {
    resetMocks();
    mockServerConnect.mockImplementation(async () => {
      throw new Error("ECONNREFUSED");
    });

    await expect(validateServerToken("http://localhost:32400", "token")).rejects.toThrow(
      PlexConnectionError,
    );
  });

  it("throws PlexConnectionError on BadRequest", async () => {
    resetMocks();
    mockServerConnect.mockImplementation(async () => {
      throw new BadRequest("Bad request");
    });

    await expect(validateServerToken("http://localhost:32400", "token")).rejects.toThrow(
      PlexConnectionError,
    );
  });

  it("throws PlexConnectionError on NotFound", async () => {
    resetMocks();
    mockServerConnect.mockImplementation(async () => {
      throw new NotFound("Not found");
    });

    await expect(validateServerToken("http://localhost:32400", "token")).rejects.toThrow(
      PlexConnectionError,
    );
  });

  it("throws PlexConnectionError for non-loopback http URL without invoking @ctrl/plex", async () => {
    resetMocks();
    await expect(validateServerToken("http://external.example.com", "token")).rejects.toThrow(
      PlexConnectionError,
    );
    expect(mockServerConnect).not.toHaveBeenCalled();
  });
});

describe("checkServerHealth", () => {
  it("throws PlexConnectionError for non-loopback http URL without invoking @ctrl/plex", async () => {
    resetMocks();
    await expect(checkServerHealth("http://external.example.com", "token", "id")).rejects.toThrow(
      PlexConnectionError,
    );
    expect(mockServerConnect).not.toHaveBeenCalled();
  });

  it("returns 'healthy' when machineIdentifier matches", async () => {
    resetMocks();
    mockServerConnect.mockImplementation(async function (this: InstanceType<typeof PlexServer>) {
      this.machineIdentifier = "expected-id";
      return this;
    });

    const result = await checkServerHealth("http://localhost:32400", "token", "expected-id");
    expect(result).toBe("healthy");
  });

  it("returns 'server_changed' when machineIdentifier mismatches", async () => {
    resetMocks();
    mockServerConnect.mockImplementation(async function (this: InstanceType<typeof PlexServer>) {
      this.machineIdentifier = "different-id";
      return this;
    });

    const result = await checkServerHealth("http://localhost:32400", "token", "expected-id");
    expect(result).toBe("server_changed");
  });

  it("returns 'unreachable' when machineIdentifier is empty", async () => {
    resetMocks();
    mockServerConnect.mockImplementation(async function (this: InstanceType<typeof PlexServer>) {
      this.machineIdentifier = "";
      return this;
    });

    const result = await checkServerHealth("http://localhost:32400", "token", "expected-id");
    expect(result).toBe("unreachable");
  });

  it("returns 'unauthorized' on Unauthorized error", async () => {
    resetMocks();
    mockServerConnect.mockImplementation(async () => {
      throw new Unauthorized("Unauthorized");
    });

    const result = await checkServerHealth("http://localhost:32400", "bad-token", "id");
    expect(result).toBe("unauthorized");
  });

  it("returns 'unreachable' on network error", async () => {
    resetMocks();
    mockServerConnect.mockImplementation(async () => {
      throw new Error("ECONNREFUSED");
    });

    const result = await checkServerHealth("http://localhost:32400", "token", "id");
    expect(result).toBe("unreachable");
  });
});

describe("getAccount", () => {
  it("returns connected MyPlexAccount on success", async () => {
    resetMocks();
    mockAccountConnect.mockImplementation(async function (
      this: InstanceType<typeof MyPlexAccount>,
    ) {
      return this;
    });

    const account = await getAccount("valid-token");
    expect(account).toBeInstanceOf(MyPlexAccount);
  });

  it("throws PlexAuthError on Unauthorized", async () => {
    resetMocks();
    mockAccountConnect.mockImplementation(async () => {
      throw new Unauthorized("Unauthorized");
    });

    await expect(getAccount("bad-token")).rejects.toThrow(PlexAuthError);
  });

  it("throws PlexConnectionError on BadRequest", async () => {
    resetMocks();
    mockAccountConnect.mockImplementation(async () => {
      throw new BadRequest("Bad request");
    });

    await expect(getAccount("token")).rejects.toThrow(PlexConnectionError);
  });

  it("throws PlexConnectionError on NotFound", async () => {
    resetMocks();
    mockAccountConnect.mockImplementation(async () => {
      throw new NotFound("Not found");
    });

    await expect(getAccount("token")).rejects.toThrow(PlexConnectionError);
  });

  it("throws PlexConnectionError on generic error", async () => {
    resetMocks();
    mockAccountConnect.mockImplementation(async () => {
      throw new Error("ECONNREFUSED");
    });

    await expect(getAccount("token")).rejects.toThrow(PlexConnectionError);
  });
});

describe("getServerResources", () => {
  it("maps resources to { name, machineId, connect }", async () => {
    resetMocks();
    const mockResource1 = {
      name: "Server One",
      clientIdentifier: "machine-1",
      connect: vi.fn().mockResolvedValue({}),
    };
    const mockResource2 = {
      name: "Server Two",
      clientIdentifier: "machine-2",
      connect: vi.fn().mockResolvedValue({}),
    };
    mockResources.mockResolvedValueOnce([mockResource1, mockResource2]);

    const account = new MyPlexAccount({ token: "token" });
    const result = await getServerResources(
      account as unknown as InstanceType<typeof MyPlexAccount>,
    );

    expect(result).toHaveLength(2);

    const first = result[0];
    const second = result[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();

    expect(first?.name).toBe("Server One");
    expect(first?.machineId).toBe("machine-1");
    expect(typeof first?.connect).toBe("function");
    expect(second?.name).toBe("Server Two");
    expect(second?.machineId).toBe("machine-2");

    // Verify connect() delegates to resource.connect()
    await first?.connect();
    expect(mockResource1.connect).toHaveBeenCalledOnce();
  });

  it("throws PlexAuthError on Unauthorized", async () => {
    resetMocks();
    mockResources.mockImplementation(async () => {
      throw new Unauthorized("Unauthorized");
    });

    const account = new MyPlexAccount({ token: "token" });
    await expect(
      getServerResources(account as unknown as InstanceType<typeof MyPlexAccount>),
    ).rejects.toThrow(PlexAuthError);
  });

  it("throws PlexConnectionError on BadRequest", async () => {
    resetMocks();
    mockResources.mockImplementation(async () => {
      throw new BadRequest("Bad request");
    });

    const account = new MyPlexAccount({ token: "token" });
    await expect(
      getServerResources(account as unknown as InstanceType<typeof MyPlexAccount>),
    ).rejects.toThrow(PlexConnectionError);
  });

  it("throws PlexConnectionError on generic error", async () => {
    resetMocks();
    mockResources.mockImplementation(async () => {
      throw new Error("Network failure");
    });

    const account = new MyPlexAccount({ token: "token" });
    await expect(
      getServerResources(account as unknown as InstanceType<typeof MyPlexAccount>),
    ).rejects.toThrow(PlexConnectionError);
  });
});

describe("discoverServers", () => {
  it("returns servers filtered to those providing 'server' with ranked connections", async () => {
    resetMocks();
    mockAccountConnect.mockImplementation(async function (
      this: InstanceType<typeof MyPlexAccount>,
    ) {
      return this;
    });
    mockResources.mockResolvedValueOnce([
      {
        name: "My PMS",
        clientIdentifier: "pms-1",
        provides: "server",
        connections: [
          {
            uri: "http://192.168.1.10:32400",
            protocol: "http",
            address: "192.168.1.10",
            port: 32400,
            local: true,
            relay: false,
          },
          {
            uri: "https://10-0-0-1.abc123.plex.direct:32400",
            protocol: "https",
            address: "10.0.0.1",
            port: 32400,
            local: false,
            relay: false,
          },
          {
            uri: "http://127.0.0.1:32400",
            protocol: "http",
            address: "127.0.0.1",
            port: 32400,
            local: true,
            relay: false,
          },
        ],
      },
      {
        name: "My Player",
        clientIdentifier: "player-1",
        provides: "player",
        connections: [
          {
            uri: "http://192.168.1.11:32500",
            protocol: "http",
            address: "192.168.1.11",
            port: 32500,
            local: true,
            relay: false,
          },
        ],
      },
    ]);

    const result = await discoverServers("valid-token");

    expect(result).toHaveLength(1);
    const server = result[0];
    expect(server).toBeDefined();
    expect(server?.name).toBe("My PMS");
    expect(server?.machineId).toBe("pms-1");
    expect(server?.connections).toHaveLength(3);

    // Remote HTTPS should be first (highest score)
    expect(server?.connections[0]?.uri).toBe("https://10-0-0-1.abc123.plex.direct:32400");
    // Local HTTP second
    expect(server?.connections[1]?.uri).toBe("http://192.168.1.10:32400");
    // Loopback last (deprioritized)
    expect(server?.connections[2]?.uri).toBe("http://127.0.0.1:32400");
  });

  it("returns empty array when no servers provide 'server'", async () => {
    resetMocks();
    mockAccountConnect.mockImplementation(async function (
      this: InstanceType<typeof MyPlexAccount>,
    ) {
      return this;
    });
    mockResources.mockResolvedValueOnce([
      {
        name: "Player",
        clientIdentifier: "p-1",
        provides: "player",
        connections: [],
      },
    ]);

    const result = await discoverServers("valid-token");
    expect(result).toHaveLength(0);
  });

  it("deprioritizes relay connections", async () => {
    resetMocks();
    mockAccountConnect.mockImplementation(async function (
      this: InstanceType<typeof MyPlexAccount>,
    ) {
      return this;
    });
    mockResources.mockResolvedValueOnce([
      {
        name: "PMS",
        clientIdentifier: "pms-1",
        provides: "server",
        connections: [
          {
            uri: "https://relay.plex.tv:443",
            protocol: "https",
            address: "relay.plex.tv",
            port: 443,
            local: false,
            relay: true,
          },
          {
            uri: "http://192.168.1.10:32400",
            protocol: "http",
            address: "192.168.1.10",
            port: 32400,
            local: true,
            relay: false,
          },
        ],
      },
    ]);

    const result = await discoverServers("token");
    const server = result[0];
    expect(server).toBeDefined();
    // Local HTTP should come before relay
    expect(server?.connections[0]?.uri).toBe("http://192.168.1.10:32400");
    expect(server?.connections[1]?.uri).toBe("https://relay.plex.tv:443");
  });

  it("throws PlexAuthError on Unauthorized", async () => {
    resetMocks();
    mockAccountConnect.mockImplementation(async () => {
      throw new Unauthorized("Unauthorized");
    });

    await expect(discoverServers("bad-token")).rejects.toThrow(PlexAuthError);
  });

  it("throws PlexConnectionError on generic error", async () => {
    resetMocks();
    mockAccountConnect.mockImplementation(async () => {
      throw new Error("Network failure");
    });

    await expect(discoverServers("token")).rejects.toThrow(PlexConnectionError);
  });
});
