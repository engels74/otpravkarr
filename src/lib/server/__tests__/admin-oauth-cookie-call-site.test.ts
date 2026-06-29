// @vitest-environment node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ISSUE-001 single-call-site guard. ADMIN_OAUTH_COOKIE_OPTIONS relaxes the admin
// cookie to SameSite=Lax; it must NEVER spread beyond the single owner-OAuth
// branch. This static scan fails loudly if a new usage appears anywhere else, so
// the relaxation cannot silently leak to other admin-session issuance.

const SRC_ROOT = join(process.cwd(), "src");
const DEFINITION_FILE = join("src", "lib", "server", "auth.ts").replaceAll("\\", "/");
const ALLOWED_USAGE_FILE = join(
  "src",
  "routes",
  "(portal)",
  "auth",
  "plex",
  "+page.server.ts",
).replaceAll("\\", "/");

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      collectSourceFiles(full, acc);
      continue;
    }
    if (!/\.(ts|svelte)$/.test(entry)) continue;
    if (/\.test\.ts$/.test(entry)) continue;
    if (entry.endsWith(".d.ts")) continue;
    acc.push(full);
  }
  return acc;
}

// Count `cookies.set(...)` calls whose argument list references
// ADMIN_OAUTH_COOKIE_OPTIONS. For each call site we track parenthesis depth to
// capture the exact argument list (up to its matching `)`), then test that slice
// for the marker. Bounding the scan by the structural close-paren — rather than a
// lexical `;`, the first `)`, or a newline — keeps the guard correct regardless of
// formatting: inner calls/object literals in earlier args don't truncate the scan,
// and prose mentions of the option outside an argument list (an explanatory comment
// above the call, or the import statement) are never miscounted.
function countAdminOauthCookieSetCalls(content: string): number {
  const marker = "cookies.set(";
  let count = 0;
  let index = content.indexOf(marker);
  while (index !== -1) {
    let depth = 1;
    let cursor = index + marker.length;
    const argsStart = cursor;
    while (cursor < content.length && depth > 0) {
      const char = content[cursor];
      if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
      cursor += 1;
    }
    if (content.slice(argsStart, cursor - 1).includes("ADMIN_OAUTH_COOKIE_OPTIONS")) {
      count += 1;
    }
    index = content.indexOf(marker, cursor);
  }
  return count;
}

describe("ADMIN_OAUTH_COOKIE_OPTIONS single-call-site guard (ISSUE-001)", () => {
  const files = collectSourceFiles(SRC_ROOT);
  const usageFiles = files.filter(
    (file) =>
      readFileSync(file, "utf8").includes("ADMIN_OAUTH_COOKIE_OPTIONS") &&
      !file.replaceAll("\\", "/").endsWith(DEFINITION_FILE),
  );

  it("is referenced (outside its definition) only by the owner OAuth page server", () => {
    const relative = usageFiles.map((file) =>
      file.replaceAll("\\", "/").slice(file.replaceAll("\\", "/").indexOf("src/")),
    );
    expect(relative).toEqual([ALLOWED_USAGE_FILE]);
  });

  it("is used as a cookies.set option exactly once", () => {
    const totalSetCalls = files.reduce((count, file) => {
      return count + countAdminOauthCookieSetCalls(readFileSync(file, "utf8"));
    }, 0);
    expect(totalSetCalls).toBe(1);
  });
});
