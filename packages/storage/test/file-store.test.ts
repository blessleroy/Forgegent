import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createTestDb } from "@forgegent/db/src/index.js";
import { users } from "@forgegent/db/src/schema.js";
import { FileStore, FileStoreError } from "../src/index.js";

let root: string;
const db = createTestDb();

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "forgegent-files-"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

async function seedUser(id: string): Promise<void> {
  await db
    .insert(users)
    .values({ id, email: `${id}@test.local`, passwordHash: "x" });
}

describe("FileStore (task 1.7 — personal-files spec)", () => {
  const alice = "user-alice";
  const bob = "user-bob";

  it("stores, lists and downloads for the owner", async () => {
    await seedUser(alice);
    const store = new FileStore(root, db);
    const { id } = await store.put({
      ownerId: alice,
      filename: "logo.png",
      mime: "image/png",
      bytes: Buffer.from("fake-png"),
    });
    const list = await store.list(alice);
    expect(list).toHaveLength(1);
    const dl = await store.openDownload(alice, id);
    expect(dl.filename).toBe("logo.png");
    expect(dl.mime).toBe("image/png");
  });

  it("AT-08: rejects another user's file id and guessed urls", async () => {
    await seedUser(bob);
    const store = new FileStore(root, db);
    const aliceFiles = await store.list(alice);
    const fileId = aliceFiles[0]!.id;
    await expect(store.openDownload(bob, fileId)).rejects.toMatchObject({
      detail: { code: "FORBIDDEN" },
    });
    await expect(store.openDownload(bob, randomUUID())).rejects.toMatchObject({
      detail: { code: "NOT_FOUND" },
    });
  });

  it("rejects oversized files against the per-file quota", async () => {
    const store = new FileStore(root, db, {
      maxFileBytes: 4,
      maxUserBytes: 1024,
    });
    await expect(
      store.put({
        ownerId: alice,
        filename: "big.bin",
        mime: "application/octet-stream",
        bytes: Buffer.alloc(8),
      }),
    ).rejects.toMatchObject({ detail: { code: "QUOTA_FILE_TOO_LARGE" } });
  });

  it("enforces the per-user quota across files", async () => {
    const store = new FileStore(root, db, {
      maxFileBytes: 10,
      maxUserBytes: 12,
    });
    await seedUser("quota-user");
    await store.put({
      ownerId: "quota-user",
      filename: "a.txt",
      mime: "text/plain",
      bytes: Buffer.alloc(8),
    });
    await expect(
      store.put({
        ownerId: "quota-user",
        filename: "b.txt",
        mime: "text/plain",
        bytes: Buffer.alloc(8),
      }),
    ).rejects.toMatchObject({ detail: { code: "QUOTA_USER_EXCEEDED" } });
  });

  it("rejects filenames that try to escape the storage root", async () => {
    const store = new FileStore(root, db);
    await expect(
      store.put({
        ownerId: alice,
        filename: "../escape.txt",
        mime: "text/plain",
        bytes: Buffer.from("x"),
      }),
    ).rejects.toMatchObject({ detail: { code: "INVALID_NAME" } });
    // Server-generated keys only: a traversal-shaped storage key is rejected.
    const evil = new FileStore(root, db) as unknown as {
      pathFor(key: string): string;
    };
    expect(() => evil.pathFor("../../etc/passwd")).toThrow(FileStoreError);
    expect(() => evil.pathFor(`${randomUUID()}.sh`)).not.toThrow();
  });

  it("blocks symlink escape via realpath check", async () => {
    const outside = mkdtempSync(join(tmpdir(), "forgegent-out-"));
    try {
      const secret = join(outside, "secret.txt");
      writeFileSync(secret, "top secret");
      const store = new FileStore(root, db);
      // Pretend a malicious storage entry points at a symlinked key.
      const key = `${randomUUID()}.lnk`;
      symlinkSync(secret, join(root, key));
      await db.insert(users).values({
        id: "symlink-user",
        email: "symlink@test.local",
        passwordHash: "x",
      });
      const { id } = await store.put({
        ownerId: "symlink-user",
        filename: "v.txt",
        mime: "text/plain",
        bytes: Buffer.from("v"),
      });
      (
        db.$client as unknown as import("better-sqlite3").Database
      )
        .prepare("UPDATE files SET storage_key = ? WHERE id = ?")
        .run(key, id);
      await expect(
        store.openDownload("symlink-user", id),
      ).rejects.toMatchObject({ detail: { code: "NOT_FOUND" } });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("soft-deletes; unknown requester cannot delete", async () => {
    await seedUser("del-user");
    const store = new FileStore(root, db);
    const { id } = await store.put({
      ownerId: "del-user",
      filename: "d.txt",
      mime: "text/plain",
      bytes: Buffer.from("d"),
    });
    await expect(store.softDelete(bob, id)).rejects.toMatchObject({
      detail: { code: "FORBIDDEN" },
    });
    await store.softDelete("del-user", id);
    expect(await store.list("del-user")).toHaveLength(0);
    await expect(store.openDownload("del-user", id)).rejects.toMatchObject({
      detail: { code: "NOT_FOUND" },
    });
  });

  it("W2: files referenced by a live task cannot be deleted (D23)", async () => {
    await seedUser("ref-user");
    const store = new FileStore(root, db);
    const { id } = await store.put({
      ownerId: "ref-user",
      filename: "in-use.txt",
      mime: "text/plain",
      bytes: Buffer.from("x"),
    });
    // A running task references the file as input.
    db.$client
      .prepare("INSERT OR IGNORE INTO users (id, email) VALUES ('rel-owner', 'rel@f.local')")
      .run();
    db.$client
      .prepare("INSERT OR IGNORE INTO agents (id, slug, name, owner_id) VALUES ('rel-agent', 'rel-agent', 'R', 'rel-owner')")
      .run();
    db.$client
      .prepare("INSERT OR IGNORE INTO agent_releases (id, agent_id, version, immutable_package_path, checksum, published_by) VALUES ('rel', 'rel-agent', '1.0.0', '/tmp', 'c', 'rel-owner')")
      .run();
    db.$client
      .prepare("INSERT OR IGNORE INTO tasks (id, owner_id, agent_release_id, state, origin, mode) VALUES ('ref-task', 'ref-user', 'rel', 'running', 'staff', 'restricted')")
      .run();
    db.$client
      .prepare("INSERT OR REPLACE INTO task_file_refs (task_id, file_id, direction) VALUES ('ref-task', ?, 'input')")
      .run(id);
    await expect(store.softDelete("ref-user", id)).rejects.toMatchObject({
      detail: { code: "REFERENCED_BY_LIVE_TASK", taskId: "ref-task" },
    });
    // Once the task reaches a terminal state, deletion proceeds.
    db.$client
      .prepare("UPDATE tasks SET state = 'completed' WHERE id = 'ref-task'")
      .run();
    await store.softDelete("ref-user", id);
    expect(await store.list("ref-user")).toHaveLength(0);
  });
});
