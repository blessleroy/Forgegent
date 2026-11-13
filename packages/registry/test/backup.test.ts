/**
 * Backup/restore acceptance (task 9.3, AT-19): snapshot the SQLite db with
 * the online-backup API, restore it into a fresh environment, and verify
 * accounts / releases (checksums) / file metadata+content survive intact.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { createTestDb, rawQuery, users } from "@forgegent/db";
import type { ForgegentDb } from "@forgegent/db";
import { createDraft, reviewDraft, ReleaseStore } from "@forgegent/registry";
import { FileStore } from "@forgegent/storage/src/index.js";

const db: ForgegentDb = createTestDb();
const releasesDir = mkdtempSync(join(tmpdir(), "bk-rel-"));
const filesDir = mkdtempSync(join(tmpdir(), "bk-files-"));
const backupDir = mkdtempSync(join(tmpdir(), "bk-backup-"));
const store = new ReleaseStore(releasesDir);
store.init();

afterAll(() => {
  for (const dir of [releasesDir, filesDir, backupDir]) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

describe("task 9.3 — backup/restore (AT-19)", () => {
  it("restores accounts, release checksums, and file content consistently", async () => {
    const admin = "bk-admin";
    const builder = "bk-builder";
    const employee = "bk-emp";
    for (const [id, email] of [
      [admin, "a@bk.local"],
      [builder, "b@bk.local"],
      [employee, "e@bk.local"],
    ] as const) {
      await db.insert(users).values({ id, email }).onConflictDoNothing();
    }
    // Publish one agent.
    const draft = await createDraft(db, {
      builderId: builder,
      slug: "bk-agent",
      payload: {
        schemaVersion: "1.0",
        name: "BK",
        description: "x",
        version: "1.0.0",
        ui: { type: "form-result", schema: { fields: [] } },
        runtime: { engine: "pi-coding-agent", mode: "restricted" },
      },
    });
    const { submitDraft } = await import("@forgegent/registry");
    await submitDraft(db, { draftId: draft.draftId, builderId: builder });
    const published = await reviewDraft(db, store, {
      draftId: draft.draftId,
      adminId: admin,
      decision: "approve",
    });
    if (!("releaseId" in published)) throw new Error("publish failed");
    // One file in the employee's space.
    const fileStore = new FileStore(filesDir, db);
    await fileStore.put({
      ownerId: employee,
      filename: "contract.txt",
      mime: "text/plain",
      bytes: Buffer.from("backup-me"),
    });

    // --- Backup: online SQLite snapshot ---
    const source = (db as unknown as { $client: Database.Database }).$client;
    await source.backup(join(backupDir, "forgegent.sqlite"));

    // --- Restore into a fresh environment ---
    const restoredDb = new Database(join(backupDir, "forgegent.sqlite"));
    const accounts = restoredDb
      .prepare("SELECT id, email FROM users ORDER BY email")
      .all() as { email: string }[];
    expect(accounts.map((a) => a.email)).toEqual([
      "a@bk.local",
      "b@bk.local",
      "e@bk.local",
    ]);
    const release = restoredDb
      .prepare("SELECT version, checksum FROM agent_releases WHERE id = ?")
      .get(published.releaseId) as { version: string; checksum: string };
    expect(release.version).toBe("1.0.0");
    // The release snapshot still verifies against the restored checksum.
    const snap = store.loadSnapshot(published.releaseId, release.checksum);
    expect(snap.version).toBe("1.0.0");
    // File metadata + content match.
    const fileMeta = restoredDb
      .prepare("SELECT filename, checksum FROM files WHERE owner_id = ?")
      .get(employee) as { filename: string; checksum: string };
    expect(fileMeta.filename).toBe("contract.txt");
    const live = await fileStore.list(employee);
    expect(live[0]!.checksum).toBe(fileMeta.checksum);
    const content = await fileStore.openDownload(employee, live[0]!.id);
    const text = await new Promise<string>((resolve) => {
      let data = "";
      content.stream.on("data", (chunk: Buffer) => (data += chunk.toString()));
      content.stream.on("end", () => resolve(data));
    });
    expect(text).toBe("backup-me");
    restoredDb.close();
    void rawQuery;
  });
});
