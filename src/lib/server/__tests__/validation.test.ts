// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  AuditRetentionSchema,
  CreateAdminSchema,
  DefaultsSchema,
  DispatcharrConfigSchema,
  LoginSchema,
  OriginsSchema,
  PlexTokenSchema,
  parseFormData,
  SessionTtlSchema,
  SyncIntervalSchema,
  sanitizeString,
} from "$lib/server/validation";

// ---------------------------------------------------------------------------
// sanitizeString
// ---------------------------------------------------------------------------

describe("sanitizeString", () => {
  it("trims leading and trailing whitespace", () => {
    expect(sanitizeString("  hello  ")).toBe("hello");
  });

  it("collapses multiple spaces into one", () => {
    expect(sanitizeString("hello   world")).toBe("hello world");
  });

  it("strips null bytes", () => {
    expect(sanitizeString("hello\x00world")).toBe("helloworld");
  });

  it("strips control characters (0x01–0x08, 0x0B, 0x0C, 0x0E–0x1F)", () => {
    expect(sanitizeString("a\x01b\x02c\x07d\x0Be\x0Cf\x1Fg")).toBe("abcdefg");
  });

  it("preserves tab (0x09)", () => {
    // Tab is whitespace, so gets collapsed to a single space with surrounding content
    expect(sanitizeString("a\tb")).toBe("a b");
  });

  it("preserves newline (0x0A) by collapsing to space", () => {
    expect(sanitizeString("a\nb")).toBe("a b");
  });

  it("preserves carriage return (0x0D) by collapsing to space", () => {
    expect(sanitizeString("a\r\nb")).toBe("a b");
  });

  it("returns empty string for empty input", () => {
    expect(sanitizeString("")).toBe("");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(sanitizeString("   ")).toBe("");
  });

  it("handles mixed control characters and whitespace", () => {
    expect(sanitizeString("  \x00hello\x01  \x02world  ")).toBe("hello world");
  });
});

// ---------------------------------------------------------------------------
// parseFormData
// ---------------------------------------------------------------------------

describe("parseFormData", () => {
  it("extracts and sanitizes form fields then validates", () => {
    const fd = new FormData();
    fd.set("username", "  admin\x00  ");
    fd.set("password", "secret");

    const result = parseFormData(fd, LoginSchema);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.username).toBe("admin");
      expect(result.data.password).toBe("secret");
    }
  });

  it("returns validation errors for invalid data", () => {
    const fd = new FormData();
    fd.set("username", "");
    fd.set("password", "");

    const result = parseFormData(fd, LoginSchema);
    expect(result.success).toBe(false);
  });

  it("ignores non-string values (e.g. File objects)", () => {
    const fd = new FormData();
    fd.set("username", "admin");
    fd.set("password", "secret");
    fd.set("file", new Blob(["content"]), "test.txt");

    const result = parseFormData(fd, LoginSchema);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LoginSchema
// ---------------------------------------------------------------------------

describe("LoginSchema", () => {
  it("accepts valid credentials", () => {
    const result = LoginSchema.safeParse({ username: "admin", password: "password123" });
    expect(result.success).toBe(true);
  });

  it("trims username", () => {
    const result = LoginSchema.safeParse({ username: "  admin  ", password: "password123" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.username).toBe("admin");
    }
  });

  it("rejects empty username", () => {
    const result = LoginSchema.safeParse({ username: "", password: "password123" });
    expect(result.success).toBe(false);
  });

  it("rejects empty password", () => {
    const result = LoginSchema.safeParse({ username: "admin", password: "" });
    expect(result.success).toBe(false);
  });

  it("rejects whitespace-only username", () => {
    const result = LoginSchema.safeParse({ username: "   ", password: "password123" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CreateAdminSchema
// ---------------------------------------------------------------------------

describe("CreateAdminSchema", () => {
  it("accepts valid admin credentials", () => {
    const result = CreateAdminSchema.safeParse({
      username: "admin_user",
      password: "longpassword12",
      confirmPassword: "longpassword12",
    });
    expect(result.success).toBe(true);
  });

  it("rejects username shorter than 3 characters", () => {
    const result = CreateAdminSchema.safeParse({
      username: "ab",
      password: "longpassword12",
      confirmPassword: "longpassword12",
    });
    expect(result.success).toBe(false);
  });

  it("rejects username longer than 32 characters", () => {
    const result = CreateAdminSchema.safeParse({
      username: "a".repeat(33),
      password: "longpassword12",
      confirmPassword: "longpassword12",
    });
    expect(result.success).toBe(false);
  });

  it("rejects username with invalid characters", () => {
    const result = CreateAdminSchema.safeParse({
      username: "admin user!",
      password: "longpassword12",
      confirmPassword: "longpassword12",
    });
    expect(result.success).toBe(false);
  });

  it("accepts username with dashes and underscores", () => {
    const result = CreateAdminSchema.safeParse({
      username: "admin-user_1",
      password: "longpassword12",
      confirmPassword: "longpassword12",
    });
    expect(result.success).toBe(true);
  });

  it("rejects password shorter than 12 characters", () => {
    const result = CreateAdminSchema.safeParse({
      username: "admin",
      password: "short",
      confirmPassword: "short",
    });
    expect(result.success).toBe(false);
  });

  it("rejects mismatched passwords", () => {
    const result = CreateAdminSchema.safeParse({
      username: "admin",
      password: "longpassword12",
      confirmPassword: "different12345",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const confirmIssue = result.error.issues.find((i) => i.path.includes("confirmPassword"));
      expect(confirmIssue?.message).toBe("Passwords do not match");
    }
  });
});

// ---------------------------------------------------------------------------
// PlexTokenSchema
// ---------------------------------------------------------------------------

describe("PlexTokenSchema", () => {
  it("accepts valid plex token and URL", () => {
    const result = PlexTokenSchema.safeParse({
      plexToken: "my-token",
      plexServerUrl: "https://plex.example.com",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty plex token", () => {
    const result = PlexTokenSchema.safeParse({
      plexToken: "",
      plexServerUrl: "https://plex.example.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid URL", () => {
    const result = PlexTokenSchema.safeParse({
      plexToken: "my-token",
      plexServerUrl: "not-a-url",
    });
    expect(result.success).toBe(false);
  });

  it("trims whitespace from fields", () => {
    const result = PlexTokenSchema.safeParse({
      plexToken: "  my-token  ",
      plexServerUrl: "  https://plex.example.com  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.plexToken).toBe("my-token");
      expect(result.data.plexServerUrl).toBe("https://plex.example.com");
    }
  });

  it("accepts http scheme for loopback hostname localhost", () => {
    const result = PlexTokenSchema.safeParse({
      plexToken: "my-token",
      plexServerUrl: "http://localhost:32400",
    });
    expect(result.success).toBe(true);
  });

  it("accepts http scheme for loopback IPv4 127.0.0.1", () => {
    const result = PlexTokenSchema.safeParse({
      plexToken: "my-token",
      plexServerUrl: "http://127.0.0.1:32400",
    });
    expect(result.success).toBe(true);
  });

  it("accepts http scheme for loopback IPv6 [::1]", () => {
    const result = PlexTokenSchema.safeParse({
      plexToken: "my-token",
      plexServerUrl: "http://[::1]:32400",
    });
    expect(result.success).toBe(true);
  });

  it("rejects http scheme for non-loopback hostname", () => {
    const result = PlexTokenSchema.safeParse({
      plexToken: "my-token",
      plexServerUrl: "http://plex.example.com:32400",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "Plex server URL must use HTTPS (HTTP only allowed for localhost, 127.0.0.1, or [::1])",
      );
    }
  });

  it("rejects http scheme for non-loopback IPv4", () => {
    const result = PlexTokenSchema.safeParse({
      plexToken: "my-token",
      plexServerUrl: "http://192.168.1.10:32400",
    });
    expect(result.success).toBe(false);
  });

  it("rejects javascript: protocol", () => {
    const result = PlexTokenSchema.safeParse({
      plexToken: "my-token",
      plexServerUrl: "javascript:alert(1)",
    });
    expect(result.success).toBe(false);
  });

  it("rejects data: protocol", () => {
    const result = PlexTokenSchema.safeParse({
      plexToken: "my-token",
      plexServerUrl: "data:text/html,<script>alert(1)</script>",
    });
    expect(result.success).toBe(false);
  });

  it("rejects file: protocol", () => {
    const result = PlexTokenSchema.safeParse({
      plexToken: "my-token",
      plexServerUrl: "file:///etc/passwd",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DispatcharrConfigSchema
// ---------------------------------------------------------------------------

describe("DispatcharrConfigSchema", () => {
  it("accepts valid dispatcharr config", () => {
    const result = DispatcharrConfigSchema.safeParse({
      dispatcharrUrl: "https://dispatcharr.example.com",
      dispatcharrApiKey: "api-key-123",
    });
    expect(result.success).toBe(true);
  });

  it("accepts http scheme for loopback hostname localhost", () => {
    const result = DispatcharrConfigSchema.safeParse({
      dispatcharrUrl: "http://localhost:8000",
      dispatcharrApiKey: "api-key-123",
    });
    expect(result.success).toBe(true);
  });

  it("accepts http scheme for loopback IPv4 127.0.0.1", () => {
    const result = DispatcharrConfigSchema.safeParse({
      dispatcharrUrl: "http://127.0.0.1:8000",
      dispatcharrApiKey: "api-key-123",
    });
    expect(result.success).toBe(true);
  });

  it("accepts http scheme for loopback IPv6 [::1]", () => {
    const result = DispatcharrConfigSchema.safeParse({
      dispatcharrUrl: "http://[::1]:8000",
      dispatcharrApiKey: "api-key-123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects http scheme for non-loopback hostname", () => {
    const result = DispatcharrConfigSchema.safeParse({
      dispatcharrUrl: "http://dispatcharr.lan:8000",
      dispatcharrApiKey: "api-key-123",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "Dispatcharr URL must use HTTPS (HTTP only allowed for localhost, 127.0.0.1, or [::1])",
      );
    }
  });

  it("rejects http scheme for non-loopback IPv4", () => {
    const result = DispatcharrConfigSchema.safeParse({
      dispatcharrUrl: "http://192.168.1.10:8000",
      dispatcharrApiKey: "api-key-123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects ftp scheme for dispatcharrUrl", () => {
    const result = DispatcharrConfigSchema.safeParse({
      dispatcharrUrl: "ftp://dispatcharr.example.com",
      dispatcharrApiKey: "api-key-123",
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional dispatcharrExternalUrl with https scheme", () => {
    const result = DispatcharrConfigSchema.safeParse({
      dispatcharrUrl: "https://dispatcharr.example.com",
      dispatcharrApiKey: "api-key-123",
      dispatcharrExternalUrl: "https://public.example.com",
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional dispatcharrExternalUrl with loopback http scheme", () => {
    const result = DispatcharrConfigSchema.safeParse({
      dispatcharrUrl: "https://dispatcharr.example.com",
      dispatcharrApiKey: "api-key-123",
      dispatcharrExternalUrl: "http://localhost:9191",
    });
    expect(result.success).toBe(true);
  });

  it("rejects optional dispatcharrExternalUrl with non-loopback http scheme", () => {
    const result = DispatcharrConfigSchema.safeParse({
      dispatcharrUrl: "https://dispatcharr.example.com",
      dispatcharrApiKey: "api-key-123",
      dispatcharrExternalUrl: "http://public.example.com",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "External URL must use HTTPS (HTTP only allowed for localhost, 127.0.0.1, or [::1])",
      );
    }
  });

  it("accepts empty string for dispatcharrExternalUrl", () => {
    const result = DispatcharrConfigSchema.safeParse({
      dispatcharrUrl: "https://dispatcharr.example.com",
      dispatcharrApiKey: "api-key-123",
      dispatcharrExternalUrl: "",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid URL", () => {
    const result = DispatcharrConfigSchema.safeParse({
      dispatcharrUrl: "not-a-url",
      dispatcharrApiKey: "api-key-123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty API key", () => {
    const result = DispatcharrConfigSchema.safeParse({
      dispatcharrUrl: "https://dispatcharr.example.com",
      dispatcharrApiKey: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects javascript: protocol for dispatcharrUrl", () => {
    const result = DispatcharrConfigSchema.safeParse({
      dispatcharrUrl: "javascript:alert(1)",
      dispatcharrApiKey: "api-key-123",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "Dispatcharr URL must use HTTPS (HTTP only allowed for localhost, 127.0.0.1, or [::1])",
      );
    }
  });

  it("rejects data: protocol for dispatcharrUrl", () => {
    const result = DispatcharrConfigSchema.safeParse({
      dispatcharrUrl: "data:text/html,<script>alert(1)</script>",
      dispatcharrApiKey: "api-key-123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects file: protocol for dispatcharrUrl", () => {
    const result = DispatcharrConfigSchema.safeParse({
      dispatcharrUrl: "file:///etc/passwd",
      dispatcharrApiKey: "api-key-123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects javascript: protocol for dispatcharrExternalUrl", () => {
    const result = DispatcharrConfigSchema.safeParse({
      dispatcharrUrl: "https://dispatcharr.example.com",
      dispatcharrApiKey: "api-key-123",
      dispatcharrExternalUrl: "javascript:alert(1)",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "External URL must use HTTPS (HTTP only allowed for localhost, 127.0.0.1, or [::1])",
      );
    }
  });

  it("rejects data: protocol for dispatcharrExternalUrl", () => {
    const result = DispatcharrConfigSchema.safeParse({
      dispatcharrUrl: "https://dispatcharr.example.com",
      dispatcharrApiKey: "api-key-123",
      dispatcharrExternalUrl: "data:text/html,<script>alert(1)</script>",
    });
    expect(result.success).toBe(false);
  });

  it("rejects file: protocol for dispatcharrExternalUrl", () => {
    const result = DispatcharrConfigSchema.safeParse({
      dispatcharrUrl: "https://dispatcharr.example.com",
      dispatcharrApiKey: "api-key-123",
      dispatcharrExternalUrl: "file:///etc/passwd",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// OriginsSchema
// ---------------------------------------------------------------------------

describe("OriginsSchema", () => {
  it("accepts non-empty origins string", () => {
    const result = OriginsSchema.safeParse({ allowedOrigins: "https://example.com" });
    expect(result.success).toBe(true);
  });

  it("rejects empty origins string", () => {
    const result = OriginsSchema.safeParse({ allowedOrigins: "" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DefaultsSchema
// ---------------------------------------------------------------------------

describe("DefaultsSchema", () => {
  it("accepts valid defaults", () => {
    const result = DefaultsSchema.safeParse({
      defaultGroupId: "1",
      defaultProfileId: "2",
      syncInterval: "15",
      defaultProvisioningMode: "automatic",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.syncInterval).toBe(15);
    }
  });

  it("accepts self_managed provisioning mode", () => {
    const result = DefaultsSchema.safeParse({
      syncInterval: "30",
      defaultProvisioningMode: "self_managed",
    });
    expect(result.success).toBe(true);
  });

  it("allows optional defaultGroupId and defaultProfileId", () => {
    const result = DefaultsSchema.safeParse({
      syncInterval: "15",
      defaultProvisioningMode: "automatic",
    });
    expect(result.success).toBe(true);
  });

  it("rejects sync interval below 1", () => {
    const result = DefaultsSchema.safeParse({
      syncInterval: "0",
      defaultProvisioningMode: "automatic",
    });
    expect(result.success).toBe(false);
  });

  it("rejects sync interval above 1440", () => {
    const result = DefaultsSchema.safeParse({
      syncInterval: "1441",
      defaultProvisioningMode: "automatic",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer sync interval", () => {
    const result = DefaultsSchema.safeParse({
      syncInterval: "15.5",
      defaultProvisioningMode: "automatic",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid provisioning mode", () => {
    const result = DefaultsSchema.safeParse({
      syncInterval: "15",
      defaultProvisioningMode: "invalid",
    });
    expect(result.success).toBe(false);
  });

  it("coerces string sync interval to number", () => {
    const result = DefaultsSchema.safeParse({
      syncInterval: "60",
      defaultProvisioningMode: "automatic",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.syncInterval).toBe(60);
    }
  });
});

// ---------------------------------------------------------------------------
// SyncIntervalSchema
// ---------------------------------------------------------------------------

describe("SyncIntervalSchema", () => {
  it("accepts valid interval", () => {
    const result = SyncIntervalSchema.safeParse({ interval: "30" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.interval).toBe(30);
    }
  });

  it("rejects interval below 1", () => {
    const result = SyncIntervalSchema.safeParse({ interval: "0" });
    expect(result.success).toBe(false);
  });

  it("rejects interval above 1440", () => {
    const result = SyncIntervalSchema.safeParse({ interval: "1441" });
    expect(result.success).toBe(false);
  });

  it("rejects non-numeric input", () => {
    const result = SyncIntervalSchema.safeParse({ interval: "abc" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AuditRetentionSchema
// ---------------------------------------------------------------------------

describe("AuditRetentionSchema", () => {
  it("accepts valid retention days", () => {
    const result = AuditRetentionSchema.safeParse({ days: "90" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.days).toBe(90);
    }
  });

  it("rejects days below 1", () => {
    const result = AuditRetentionSchema.safeParse({ days: "0" });
    expect(result.success).toBe(false);
  });

  it("rejects non-numeric input", () => {
    const result = AuditRetentionSchema.safeParse({ days: "abc" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SessionTtlSchema
// ---------------------------------------------------------------------------

describe("SessionTtlSchema", () => {
  it("accepts valid TTL", () => {
    const result = SessionTtlSchema.safeParse({ seconds: "3600" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.seconds).toBe(3600);
    }
  });

  it("rejects TTL below 300", () => {
    const result = SessionTtlSchema.safeParse({ seconds: "100" });
    expect(result.success).toBe(false);
  });

  it("rejects TTL above 86400", () => {
    const result = SessionTtlSchema.safeParse({ seconds: "100000" });
    expect(result.success).toBe(false);
  });

  it("accepts minimum TTL of 300", () => {
    const result = SessionTtlSchema.safeParse({ seconds: "300" });
    expect(result.success).toBe(true);
  });

  it("accepts maximum TTL of 86400", () => {
    const result = SessionTtlSchema.safeParse({ seconds: "86400" });
    expect(result.success).toBe(true);
  });
});
