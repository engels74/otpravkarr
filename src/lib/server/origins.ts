export type OriginNormalizationResult = {
  origins: string[];
  invalidOrigin: string | null;
};

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
