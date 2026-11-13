/**
 * Personal file space storage (task 1.7, personal-files spec).
 *
 * Security model:
 * - Storage keys are server-generated (random id + sanitized extension);
 *   client-supplied names never influence disk paths (AT-08).
 * - Every read/download/delete takes the requesting ownerId and enforces
 *   ownership server-side.
 * - Deletes are soft by default; hard removal is blocked while a live task
 *   references the file (D23).
 * - Per-file and per-user quota limits are enforced on write (FR-07.6).
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdirSync, realpathSync } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { and, eq, isNull, sql } from "@forgegent/db";
import { files, taskFileRefs, tasks } from "@forgegent/db/src/schema.js";
import type { ForgegentDb } from "@forgegent/db/src/index.js";

export interface QuotaConfig {
  maxFileBytes: number;
  maxUserBytes: number;
}

export const DEFAULT_QUOTA: QuotaConfig = {
  maxFileBytes: 50 * 1024 * 1024, // 50 MB per file
  maxUserBytes: 2 * 1024 * 1024 * 1024, // 2 GB per user
};

export type StorageError =
  | { code: "QUOTA_FILE_TOO_LARGE"; maxFileBytes: number }
  | { code: "QUOTA_USER_EXCEEDED"; maxUserBytes: number }
  | { code: "NOT_FOUND" }
  | { code: "FORBIDDEN" }
  | { code: "REFERENCED_BY_LIVE_TASK"; taskId: string }
  | { code: "INVALID_NAME" };

export class FileStoreError extends Error {
  constructor(public readonly detail: StorageError) {
    super(`FileStore: ${detail.code}`);
  }
}

/** Only allow a conservative extension charset for generated storage keys. */
function safeExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return "";
  const ext = filename.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,10}$/.test(ext) ? `.${ext}` : "";
}

const LIVE_TASK_STATES = new Set([
  "pending",
  "starting",
  "running",
  "waiting_input",
]);

export class FileStore {
  private root: string;

  constructor(
    rootDir: string,
    private readonly db: ForgegentDb,
    private readonly quota: QuotaConfig = DEFAULT_QUOTA,
  ) {
    // realpath immediately so later startsWith checks match macOS /var vs
    // /private/var style symlinked temp dirs.
    mkdirSync(resolve(rootDir), { recursive: true });
    this.root = realpathSync(resolve(rootDir));
  }

  private pathFor(storageKey: string): string {
    // storageKey is always server-generated `uuid.ext`; validate strictly
    // before touching the filesystem (path traversal defence).
    if (!/^[0-9a-f-]{36}(\.[a-z0-9]{1,10})?$/.test(storageKey)) {
      throw new FileStoreError({ code: "NOT_FOUND" });
    }
    const p = join(this.root, storageKey);
    if (!p.startsWith(this.root + "/") && p !== this.root) {
      throw new FileStoreError({ code: "NOT_FOUND" });
    }
    return p;
  }

  /** Persist an uploaded file for a user and record metadata. */
  async put(params: {
    ownerId: string;
    filename: string;
    mime: string;
    bytes: Buffer;
    taskId?: string;
  }): Promise<{ id: string; storageKey: string; checksum: string }> {
    const { ownerId, filename, mime, bytes } = params;
    if (filename.includes("/") || filename.includes("\0") || filename === "") {
      throw new FileStoreError({ code: "INVALID_NAME" });
    }
    if (bytes.byteLength > this.quota.maxFileBytes) {
      throw new FileStoreError({
        code: "QUOTA_FILE_TOO_LARGE",
        maxFileBytes: this.quota.maxFileBytes,
      });
    }
    const usage = await this.usageBytes(ownerId);
    if (usage + bytes.byteLength > this.quota.maxUserBytes) {
      throw new FileStoreError({
        code: "QUOTA_USER_EXCEEDED",
        maxUserBytes: this.quota.maxUserBytes,
      });
    }

    const id = randomUUID();
    const storageKey = `${randomUUID()}${safeExtension(filename)}`;
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const diskPath = this.pathFor(storageKey);
    await writeFile(diskPath, bytes);

    await this.db.insert(files).values({
      id,
      ownerId,
      taskId: params.taskId ?? null,
      storageKey,
      filename,
      size: bytes.byteLength,
      mime,
      checksum,
    });
    return { id, storageKey, checksum };
  }

  /** Server-side ACL: only the owner (or delegated checker) may read. */
  async openDownload(requesterId: string, fileId: string) {
    const row = await this.db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), isNull(files.deletedAt)))
      .get();
    if (!row) throw new FileStoreError({ code: "NOT_FOUND" });
    if (row.ownerId !== requesterId) {
      throw new FileStoreError({ code: "FORBIDDEN" });
    }
    const diskPath = this.pathFor(row.storageKey);
    // Symlink escape defence: the real path must stay inside the root.
    const real = realpathSync(diskPath);
    if (!real.startsWith(this.root + "/")) {
      throw new FileStoreError({ code: "NOT_FOUND" });
    }
    const info = await stat(real);
    return {
      filename: row.filename,
      mime: row.mime,
      size: info.size,
      stream: createReadStream(real),
    };
  }

  /** Soft delete; blocked while referenced by a non-terminal task (D23). */
  async softDelete(requesterId: string, fileId: string): Promise<void> {
    const row = await this.db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), isNull(files.deletedAt)))
      .get();
    if (!row) throw new FileStoreError({ code: "NOT_FOUND" });
    if (row.ownerId !== requesterId) {
      throw new FileStoreError({ code: "FORBIDDEN" });
    }
    const liveRef = this.db
      .select({ taskId: taskFileRefs.taskId, state: tasks.state })
      .from(taskFileRefs)
      .innerJoin(tasks, eq(tasks.id, taskFileRefs.taskId))
      .where(and(eq(taskFileRefs.fileId, fileId)))
      .all()
      .find((r: { taskId: string; state: string }) =>
        LIVE_TASK_STATES.has(r.state),
      );
    if (liveRef) {
      throw new FileStoreError({
        code: "REFERENCED_BY_LIVE_TASK",
        taskId: liveRef.taskId,
      });
    }
    await this.db
      .update(files)
      .set({ deletedAt: new Date() })
      .where(eq(files.id, fileId));
  }

  async usageBytes(ownerId: string): Promise<number> {
    const row = await this.db
      .select({ total: sql<number>`coalesce(sum(${files.size}), 0)` })
      .from(files)
      .where(and(eq(files.ownerId, ownerId), isNull(files.deletedAt)))
      .get();
    return row?.total ?? 0;
  }

  async list(ownerId: string) {
    return this.db
      .select()
      .from(files)
      .where(and(eq(files.ownerId, ownerId), isNull(files.deletedAt)))
      .all();
  }
}
