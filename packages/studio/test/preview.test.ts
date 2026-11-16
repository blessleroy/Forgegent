import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb, rawQuery, users } from "@forgegent/db";
import type { ForgegentDb } from "@forgegent/db";
import { ReleaseStore } from "@forgegent/registry";
import { listTasksForUser } from "@forgegent/tasks";
import {
  createDraftTestRun,
  HeuristicBuilderAgent,
  startConversation,
} from "../src/index.js";

const db: ForgegentDb = createTestDb();
const store = new ReleaseStore(mktemp());
const builder = "preview-builder";

function mktemp(): string {
  return mkdtempSync(join(tmpdir(), "preview-rel-"));
}

describe("preview test runs (task 6.3 — N4 isolation)", () => {
  it("creates an origin=test task bound to the draft snapshot", async () => {
    await db.insert(users).values({ id: builder, email: "b@p.local" }).onConflictDoNothing();
    const created = await startConversation(db, new HeuristicBuilderAgent(), {
      builderId: builder,
      slug: "preview-agent",
      brief: "海报 Agent",
    });
    const run = await createDraftTestRun(db, store, {
      draftId: created.draftId,
      builderId: builder,
      inputSummary: "预览：主题 测试 / 风格 简约",
    });
    const task = rawQuery<{ origin: string; agent_release_id: string; state: string }>(
      db,
      "SELECT origin, agent_release_id, state FROM tasks WHERE id = ?",
      run.taskId,
    )[0];
    expect(task.origin).toBe("test");
    expect(task.agent_release_id).toBe(run.testReleaseId);
    expect(task.state).toBe("pending");
    // The active release pointer is untouched (draft is unpublished).
    const active = rawQuery<{ active_release_id: string | null }>(
      db,
      "SELECT active_release_id FROM agents WHERE slug = 'preview-agent'",
    )[0];
    expect(active.active_release_id).toBeNull();
  });

  it("test tasks never appear in staff task lists (N4)", async () => {
    // listTasksForUser filters origin = 'staff' only.
    const list = listTasksForUser(db, builder);
    expect(list.length).toBe(0);
  });

  it("non-owner cannot run preview tests (D19)", async () => {
    const created = await startConversation(db, new HeuristicBuilderAgent(), {
      builderId: builder,
      slug: "preview-guard",
      brief: "海报 Agent",
    });
    await expect(
      createDraftTestRun(db, store, {
        draftId: created.draftId,
        builderId: "someone-else",
        inputSummary: "x",
      }),
    ).rejects.toThrow(/owner/);
  });
});
