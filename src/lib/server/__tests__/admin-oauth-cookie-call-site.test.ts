// @vitest-environment node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";
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

// Resolve the trailing identifier of a `.set(...)` receiver so both
// `cookies.set(...)` and `event.cookies.set(...)` are recognised, while
// unrelated `.set(...)` calls (Map, Set, etc.) are not.
function receiverIsCookies(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) return expression.text === "cookies";
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text === "cookies";
  return false;
}

// Count `cookies.set(...)` calls whose argument list references
// ADMIN_OAUTH_COOKIE_OPTIONS, using the TypeScript parser rather than a text
// scan. Parsing structurally ignores comments, strings, and template literals,
// so a documentation mention of `cookies.set(` (e.g. the explanatory comment
// above the real call site) can never be miscounted as a call. We only parse
// `.ts` files: the sensitive cookie code lives in server `.ts` modules, and the
// file-scope guard above already covers `.svelte` files via a plain-string check.
function countAdminOauthCookieSetCalls(fileName: string, content: string): number {
  const source = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);
  let count = 0;

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "set" &&
      receiverIsCookies(node.expression.expression) &&
      node.arguments.some(
        (arg) => ts.isIdentifier(arg) && arg.text === "ADMIN_OAUTH_COOKIE_OPTIONS",
      )
    ) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
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
      if (!file.endsWith(".ts")) return count;
      return count + countAdminOauthCookieSetCalls(file, readFileSync(file, "utf8"));
    }, 0);
    expect(totalSetCalls).toBe(1);
  });
});
