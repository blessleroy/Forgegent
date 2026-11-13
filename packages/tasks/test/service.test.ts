import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  agentReleases,
  agents,
  appendTaskEvent,
  createTestDb,
  readTaskEvents,
  taskFileRefs,
  users,
} from "@forgegent/db";
import type { ForgegentDb } from "@forgegent/db";
import {
  cancelTask,
  continueTask,
  createTask,
  getTaskForUser,
  listTasksForUser,
  TaskError,
  transitionTask,
} from "../src/service.js";
import { ReleaseStore } from "@forgegent/registry";
import { createDraft, reviewDraft, setAgentGrants, submitDraft } from "@forgegent/registry";

const db: ForgegentDb = createTestDb();
const store = new ReleaseStore("/tmp/forgegent-task-tests/releases");

const owner = "task-owner";
const other = "task-other";
const admin = "task-admin";
const builder = "task-builder";

async function seed() {
  for (const [id, email] of [
    [owner, "owner@t.local"],
    [other, "other@t.local"],
    [admin, "admin@t.local"],
    [builder, "builder@t.local"],
  ] as const) {
    await db.insert(users).values({ id, email }).onConflictDoNothing();
  }
}

async function publishAgent(slug: string, withGrants = true) {
  const draft = await createDraft(db, {
    builderId: builder,
    slug,
    payload: {
      schemaVersion: "1.0",
      name: "Poster",
      description: "poster agent",
      version: "1.0.0",
      ui: { type: "form-result", schema: { fields: [] } },
      runtime: { engine: "pi-coding-agent", mode: "restricted" },
    },
  });
  await submitDraft(db, { draftId: draft.draftId, builderId: builder });
  const result = await reviewDraft(db, store, {
    draftId: draft.draftId,
    adminId: admin,
    decision: "approve",
  });
  if (!("releaseId" in result)) throw new Error("publish failed");
  if (withGrants) {
    await setAgentGrants(db, {
      agentId: draft.agentId,
      grants: [{ subjectType: "all_users" }],
    });
  }
  return { agentId: draft.agentId, releaseId: result.releaseId };
}

describe("task lifecycle (tasks 4.1/4.3 — task-execution spec)", () => {
  it("creates a task bound to the active release with FR-06.1 fields", async () => {
    await seed();
    const agent = await publishAgent("lifecycle-agent");
    const task = await createTask(db, {
      ownerId: owner,
      roles: ["employee"],
      agentId: agent.agentId,
      inputSummary: "海报： autumn sale, warm palette",
    });
    expect(task.state).toBe("pending");
    expect(task.agentReleaseId).toBe(agent.releaseId);
    expect(task.sessionId).toBeTruthy();
    const events = readTaskEvents(db, task.id);
    expect(events[0]!.eventType).toBe("task.created");
  });

  it("rejects creation without use permission (FR-09.1)", async () => {
    await seed();
    const agent = await publishAgent("noperm-agent", false);
    // No grants configured for this agent.
    await expect(
      createTask(db, {
        ownerId: other,
        roles: ["employee"],
        agentId: agent.agentId,
        inputSummary: "x",
      }),
    ).rejects.toMatchObject({ code: "AGENT_NOT_USABLE" });
  });

  it("rejects input files not owned by the creator", async () => {
    await seed();
    const agent = await publishAgent("filecheck-agent");
    await db
      .insert(users)
      .values({ id: "file-owner", email: "f@t.local" })
      .onConflictDoNothing();
    db.$client
      .prepare(
        "INSERT OR REPLACE INTO files (id, owner_id, storage_key, filename, size, mime, checksum) VALUES ('file-x', 'file-owner', 'k', 'f.png', 1, 'image/png', 'c')",
      )
      .run();
    await expect(
      createTask(db, {
        ownerId: owner,
        roles: ["employee"],
        agentId: agent.agentId,
        inputSummary: "x",
        inputFileIds: ["file-x"],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("happy path transitions and rejects illegal ones", async () => {
    const agent = await publishAgent("transitions-agent");
    const task = await createTask(db, {
      ownerId: owner,
      roles: ["employee"],
      agentId: agent.agentId,
      inputSummary: "x",
    });
    expect((await transitionTask(db, task.id, "pending", "starting")).state).toBe("starting");
    expect((await transitionTask(db, task.id, "starting", "running")).state).toBe("running");
    await expect(
      transitionTask(db, task.id, "running", "starting"),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect((await transitionTask(db, task.id, "running", "completed")).state).toBe("completed");
    await expect(
      transitionTask(db, task.id, "completed", "pending"),
    ).resolves.toBeTruthy(); // continue requeue edge
  });

  it("continue reuses task+session from every terminal state (D17/AT-13)", async () => {
    const agent = await publishAgent("continue-agent");
    const task = await createTask(db, {
      ownerId: owner,
      roles: ["employee"],
      agentId: agent.agentId,
      inputSummary: "first run",
    });
    await transitionTask(db, task.id, "pending", "starting");
    await transitionTask(db, task.id, "starting", "running");
    await transitionTask(db, task.id, "running", "completed");
    const continued = await continueTask(db, {
      taskId: task.id,
      userId: owner,
      roles: ["employee"],
      message: "把标题改为 X 并重新导出",
    });
    expect(continued.state).toBe("pending");
    expect(continued.sessionId).toBe(task.sessionId);
    expect(continued.id).toBe(task.id);
    // The continued task appears exactly once in the owner's list (AT-13).
    const mine = listTasksForUser(db, owner);
    expect(mine.filter((t) => t.id === task.id)).toHaveLength(1);
    const events = readTaskEvents(db, task.id);
    expect(events.some((e) => e.eventType === "task.continued")).toBe(true);
  });

  it("waiting_input continue resumes running (D27)", async () => {
    const agent = await publishAgent("waiting-agent");
    const task = await createTask(db, {
      ownerId: owner,
      roles: ["employee"],
      agentId: agent.agentId,
      inputSummary: "outline flow",
    });
    await transitionTask(db, task.id, "pending", "starting");
    await transitionTask(db, task.id, "starting", "running");
    await transitionTask(db, task.id, "running", "waiting_input");
    const resumed = await continueTask(db, {
      taskId: task.id,
      userId: owner,
      roles: ["employee"],
      message: "确认大纲",
    });
    expect(resumed.state).toBe("running");
  });

  it("continue is blocked while running and for non-owners", async () => {
    const agent = await publishAgent("contguard-agent");
    const task = await createTask(db, {
      ownerId: owner,
      roles: ["employee"],
      agentId: agent.agentId,
      inputSummary: "x",
    });
    await expect(
      continueTask(db, { taskId: task.id, userId: owner, roles: ["employee"], message: "m" }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    await transitionTask(db, task.id, "pending", "cancelled");
    await expect(
      continueTask(db, { taskId: task.id, userId: other, roles: ["employee"], message: "m" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("cancel: owner or admin, terminal afterwards; visibility owner/admin only (N7)", async () => {
    const agent = await publishAgent("cancel-agent");
    const task = await createTask(db, {
      ownerId: owner,
      roles: ["employee"],
      agentId: agent.agentId,
      inputSummary: "x",
    });
    await expect(
      cancelTask(db, { taskId: task.id, userId: other, roles: ["employee"] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const cancelled = await cancelTask(db, {
      taskId: task.id,
      userId: owner,
      roles: ["employee"],
    });
    expect(cancelled.state).toBe("cancelled");
    await expect(
      getTaskForUser(db, { taskId: task.id, userId: other, roles: ["employee"] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      (await getTaskForUser(db, { taskId: task.id, userId: admin, roles: ["admin"] })).id,
    ).toBe(task.id);
    await expect(
      cancelTask(db, { taskId: task.id, userId: owner, roles: ["employee"] }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});
