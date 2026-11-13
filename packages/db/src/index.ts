/**
 * Database bootstrap: open SQLite (WAL) and run idempotent migrations.
 *
 * Migrations are plain SQL files under src/migrations, applied in order and
 * tracked in a __migrations journal. `CREATE ... IF NOT EXISTS` semantics and
 * the journal make repeated runs safe (task 1.3 verification).
 */
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";

const here = dirname(fileURLToPath(import.meta.url));

export type ForgegentDb = BetterSQLite3Database<typeof schema>;

export { audit, logJson, redact } from "./audit.js";
export type { AuditEvent } from "./audit.js";
export {
  ensureInitialAdmin,
  rolesForUser,
  isUserActive,
} from "./bootstrap.js";
export type { InitialAdminEnv, InitialAdminResult } from "./bootstrap.js";
export {
  claimNextTask,
  renewLease,
  finishLeasedTask,
  reclaimStaleLeases,
  newLeaseOwnerId,
} from "./queue.js";
export type { ClaimedTask } from "./queue.js";
export {
  appendTaskEvent,
  readTaskEvents,
} from "./events.js";

/** Raw parameterized SQL escape hatch (avoid cross-package drizzle typing). */
export function rawExec(
  db: ForgegentDb,
  sql: string,
  ...params: unknown[]
): void {
  type WithClient = { $client: { prepare(s: string): { run(...p: unknown[]): unknown } } };
  (db as unknown as WithClient).$client.prepare(sql).run(...params);
}

/** Raw parameterized SELECT helper returning typed rows. */
export function rawQuery<T>(
  db: ForgegentDb,
  sql: string,
  ...params: unknown[]
): T[] {
  type WithClient = { $client: { prepare(s: string): { all(...p: unknown[]): T[] } } };
  return (db as unknown as WithClient).$client.prepare(sql).all(...params);
}
export * from "./schema.js";

export function createDb(dbPath: string): ForgegentDb {
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(sqlite);
  return db;
}

/** In-memory database for tests. */
export function createTestDb(): ForgegentDb {
  return createDb(":memory:");
}

const JOURNAL_TABLE = `CREATE TABLE IF NOT EXISTS __migrations (
  name TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);`;

export function migrate(sqlite: Database.Database): string[] {
  sqlite.exec(JOURNAL_TABLE);
  const applied = new Set(
    (
      sqlite.prepare("SELECT name FROM __migrations").all() as {
        name: string;
      }[]
    ).map((row) => row.name),
  );

  const migrationsDir = join(here, "migrations");
  let files: string[] = [];
  try {
    files = readFileSync(join(migrationsDir, "index.json"), "utf-8")
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as string);
  } catch {
    files = [];
  }

  const justApplied: string[] = [];
  for (const name of files) {
    if (applied.has(name)) continue;
    const sqlText = readFileSync(join(migrationsDir, name), "utf-8");
    const run = sqlite.transaction(() => {
      sqlite.exec(sqlText);
      sqlite.prepare("INSERT INTO __migrations (name) VALUES (?)").run(name);
    });
    run();
    justApplied.push(name);
  }
  return justApplied;
}
