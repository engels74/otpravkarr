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
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized.startsWith("127.")
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

  if (
    isLoopbackHostname(configured.hostname) &&
    !areEquivalentLoopbackOrigins(configured, request)
  ) {
    return request.origin;
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
