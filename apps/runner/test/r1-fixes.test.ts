/**
 * R1 remediation regressions (tasks 1.1 / 1.9) at the runner layer:
 * - artifacts are stored under the SHARED root (the same FileStore root the
 *   web file API reads), so produced artifacts are downloadable end-to-end.
 * - gateway context carries the task owner's real server-side roles.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createTestDb, rawExec } from "@forgegent/db";
import { FileStore } from "@forgegent/storage";
import {
  createProductionDeps,
  gatewayContextForTask,
} from "../src/executor.js";

const db = createTestDb();
const wsRoot = mkdtempSync(join(tmpdir(), "r1-ws-"));
const artifactRoot = mkdtempSync(join(tmpdir(), "r1-art-"));

afterAll(() => {
  for (const dir of [wsRoot, artifactRoot]) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

describe("R1 task 1.1 — artifact root is the shared files root", () => {
  it("saveArtifact writes into artifactRoot and is downloadable from it", async () => {
    // files.task_id has an FK to tasks — seed the minimal chain.
    rawExec(
      db,
      "INSERT OR IGNORE INTO users (id, email) VALUES ('r1-owner', 'owner@r1.local')",
    );
    rawExec(
      db,
      "INSERT OR IGNORE INTO agents (id, slug, name, owner_id) VALUES ('r1-agent', 'r1-art-agent', 'R1 Agent', 'r1-owner')",
    );
    rawExec(
      db,
      "INSERT OR IGNORE INTO agent_releases (id, agent_id, version, immutable_package_path, checksum, published_by) VALUES ('r1-rel', 'r1-agent', '1.0.0', '/tmp/pkg', 'abc', 'r1-owner')",
    );
    rawExec(
      db,
      "INSERT OR IGNORE INTO tasks (id, owner_id, agent_release_id, state) VALUES ('r1-task', 'r1-owner', 'r1-rel', 'completed')",
    );
    const deps = createProductionDeps(db, wsRoot, artifactRoot);
    const saved = await deps.saveArtifact(
      "r1-owner",
      "r1-task",
      "poster.png",
      "image/png",
      Buffer.from("fake-png-bytes"),
    );
    // The SAME root the web download route uses can serve the artifact.
    const store = new FileStore(artifactRoot, db);
    const dl = await store.openDownload("r1-owner", saved.id);
    expect(dl.filename).toBe("poster.png");
    expect(dl.mime).toBe("image/png");
    // Consume the stream fully (also keeps temp dirs alive during the read).
    const chunks: Buffer[] = [];
    for await (const chunk of dl.stream) {
      chunks.push(chunk as Buffer);
    }
    expect(Buffer.concat(chunks).toString()).toBe("fake-png-bytes");
  });
});

describe("R1 task 1.9 — gateway context carries real owner roles", () => {
  it("an admin task owner yields [admin], not the hardcoded employee placeholder", async () => {
    rawExec(
      db,
      "INSERT OR IGNORE INTO users (id, email) VALUES ('r1-admin', 'admin@r1.local')",
    );
    rawExec(
      db,
      "INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES ('r1-admin', 'role-admin')",
    );
    const ctx = await gatewayContextForTask(db, {
      ownerId: "r1-admin",
      id: "r1-task",
    });
    expect(ctx.userId).toBe("r1-admin");
    expect(ctx.taskId).toBe("r1-task");
    expect(ctx.roles).toEqual(["admin"]);
  });
});
