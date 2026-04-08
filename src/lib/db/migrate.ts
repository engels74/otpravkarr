import type { Database } from "bun:sqlite";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

// After svelte-adapter-bun builds the server, code is bundled into
// build/server/chunks/ while the build script copies migrations to
// build/server/migrations. We check both the sibling path (works in dev
// where this file lives next to migrations/) and the parent path (works
// in production where import.meta.dirname is build/server/chunks/).
function resolveMigrationsDir(): string {
  const base = import.meta.dirname ?? ".";
  const sibling = resolve(base, "migrations");
  if (existsSync(sibling)) return sibling;
  return resolve(base, "..", "migrations");
}

const MIGRATIONS_DIR = resolveMigrationsDir();

const CREATE_MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS _migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`;

interface MigrationFile {
  version: number;
  name: string;
  filename: string;
}

function parseMigrationFiles(dir: string): MigrationFile[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (err) {
    throw new Error(
      `Failed to read migrations directory: ${dir} — ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const migrations: MigrationFile[] = [];

  for (const filename of entries) {
    if (!filename.endsWith(".sql")) continue;
    const match = filename.match(/^(\d+)_(.+)\.sql$/);
    if (!match) {
      console.warn(
        `Migration file "${filename}" does not match expected pattern NNN_name.sql and will be skipped`,
      );
      continue;
    }
    const version = Number(match[1]);
    const name = match[2] ?? "";
    migrations.push({ version, name, filename });
  }

  migrations.sort((a, b) => a.version - b.version);
  return migrations;
}

function getAppliedVersions(db: Database): Set<number> {
  const rows = db.prepare("SELECT version FROM _migrations").all() as { version: number }[];
  return new Set(rows.map((r) => r.version));
}

export async function runMigrations(
  db: Database,
  migrationsDir: string = MIGRATIONS_DIR,
): Promise<number> {
  db.exec(CREATE_MIGRATIONS_TABLE);

  const files = parseMigrationFiles(migrationsDir);
  if (files.length === 0) return 0;

  // Pre-read all migration SQL files before entering the transaction
  const fileSqlMap = new Map<string, string>();
  for (const f of files) {
    const filePath = join(migrationsDir, f.filename);
    fileSqlMap.set(f.filename, await Bun.file(filePath).text());
  }

  // Wrap the entire check-and-apply in a single transaction so that
  // getAppliedVersions + pending filter + apply is atomic.
  const applied = db.transaction(() => {
    const appliedVersions = getAppliedVersions(db);
    const pending = files.filter((f) => !appliedVersions.has(f.version));
    if (pending.length === 0) return 0;

    const insertMigration = db.prepare("INSERT INTO _migrations (version, name) VALUES (?, ?)");

    for (const migration of pending) {
      const sql = fileSqlMap.get(migration.filename);
      if (sql === undefined) {
        throw new Error(
          `Migration file "${migration.filename}" was not pre-loaded — this is a bug in the migration runner`,
        );
      }
      if (sql) {
        db.exec(sql);
      }
      insertMigration.run(migration.version, migration.name);
    }

    return pending.length;
  })();

  return applied;
}
