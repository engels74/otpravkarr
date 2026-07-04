export type OriginNormalizationResult = {
  origins: string[];
  invalidOrigin: string | null;
};

function toOriginUrl(rawOrigin: string | null | undefined): URL | null {
  const trimmedOrigin = rawOrigin?.trim();
  if (!trimmedOrigin) {
    return null;
  }

  try {
    const parsed = new URL(trimmedOrigin);
    if (parsed.origin === "null") {
      return null;
    }
    return new URL(parsed.origin);
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  const octets = normalized.split(".");
  const isIpv4Loopback =
    octets.length === 4 &&
    octets.every((part) => /^\d+$/.test(part)) &&
    Number(octets[0]) === 127 &&
    octets.every((part) => {
      const value = Number(part);
      return value >= 0 && value <= 255;
    });

  return (
    normalized === "localhost" || normalized === "::1" || normalized === "[::1]" || isIpv4Loopback
  );
}

function normalizedPort(origin: URL): string {
  if (origin.port) {
    return origin.port;
  }
  return origin.protocol === "https:" ? "443" : "80";
}

function areEquivalentLoopbackOrigins(left: URL, right: URL): boolean {
  return (
    isLoopbackHostname(left.hostname) &&
    isLoopbackHostname(right.hostname) &&
    left.protocol === right.protocol &&
    normalizedPort(left) === normalizedPort(right)
  );
}

export function selectActivePublicOrigin(
  configuredOrigin: string | null | undefined,
  requestOrigin: string,
): string {
  const configured = toOriginUrl(configuredOrigin);
  const request = toOriginUrl(requestOrigin);

  if (!request) {
    return configured?.origin ?? requestOrigin.trim().replace(/\/$/, "");
  }

  if (!configured) {
    return request.origin;
  }

  if (isLoopbackHostname(configured.hostname)) {
    if (areEquivalentLoopbackOrigins(configured, request)) {
      // Preserve the concrete loopback hostname the browser used to start OAuth
      // (localhost vs 127.0.0.1 vs [::1]) so the Plex callback returns to the
      // same listener/cookie scope instead of silently switching hostnames.
      return request.origin;
    }

    // When the configured origin is a loopback that doesn't match the request,
    // return the configured origin rather than falling back to the request origin.
    // Falling back to request.origin could let a spoofed Host header influence
    // Plex OAuth callback URLs when ORIGIN is misconfigured to a loopback value.
    console.warn(
      `[origins] Configured origin ${configured.origin} is a loopback that does not match ` +
        `request origin ${request.origin}. Using configured origin to avoid Host header influence.`,
    );
    return configured.origin;
  }

  return configured.origin;
}

export function parseAndNormalizeOrigins(
  rawOrigins: string,
  separator: string | RegExp,
): OriginNormalizationResult {
  const origins = rawOrigins
    .split(separator)
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  const normalizedOrigins: string[] = [];

  for (const origin of origins) {
    try {
      const parsedOrigin = new URL(origin).origin;
      if (parsedOrigin === "null") {
        return { origins: [], invalidOrigin: origin };
      }
      normalizedOrigins.push(parsedOrigin);
    } catch {
      return { origins: [], invalidOrigin: origin };
    }
  }

  return { origins: normalizedOrigins, invalidOrigin: null };
}
