import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { createDb, createTestDb, migrate } from "../src/index.js";

const EXPECTED_TABLES = [
  "users",
  "roles",
  "user_roles",
  "departments",
  "user_departments",
  "categories",
  "agents",
  "agent_drafts",
  "agent_releases",
  "agent_grants",
  "skills",
  "skill_versions",
  "skill_submissions",
  "skill_bindings",
  "resources",
  "resource_grants",
  "tasks",
  "task_events",
  "files",
  "task_file_refs",
  "session_refs",
  "tool_policies",
  "audit_logs",
  "usage_records",
  "studio_conversations",
];

function tableNames(sqlite: Database.Database): Set<string> {
  return new Set(
    (
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[]
    ).map((r) => r.name),
  );
}

describe("database schema (task 1.3)", () => {
  it("creates all PRD §9 tables plus N3/D23/N4 additions", () => {
    const db = createTestDb();
    const names = tableNames((db.$client as unknown as Database.Database));
    for (const table of EXPECTED_TABLES) {
      expect(names, `missing table: ${table}`).toContain(table);
    }
  });

  it("migrations are idempotent — re-run applies nothing new", () => {
    const sqlite = new Database(":memory:");
    const first = migrate(sqlite);
    const second = migrate(sqlite);
    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual([]);
    sqlite.close();
  });

  it("WAL journal mode is enabled for file-backed databases", () => {
    const dir = mkdtempSync(join(tmpdir(), "forgegent-wal-"));
    try {
      const db = createDb(join(dir, "test.sqlite"));
      const mode = (
        db.$client as unknown as Database.Database
      ).pragma("journal_mode", { simple: true });
      expect(mode).toBe("wal");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("seed roles contain the three platform roles", () => {
    const db = createTestDb();
    const roles = (
      db.$client as unknown as Database.Database
    )
      .prepare("SELECT name FROM roles ORDER BY name")
      .all() as { name: string }[];
    expect(roles.map((r) => r.name)).toEqual(["admin", "builder", "employee"]);
  });
});
