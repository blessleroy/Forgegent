import { describe, expect, it } from "vitest";
import {
  claimNextTask,
  createTestDb,
  finishLeasedTask,
  reclaimStaleLeases,
  tasks,
  agentReleases,
  agents,
  users,
} from "@forgegent/db";
import { Scheduler, type HandlerOutcome } from "../src/scheduler.js";
import type { ClaimedTask } from "@forgegent/db";

const db = createTestDb();

function stateOf(taskId: string): string | undefined {
  const row = db.$client
    .prepare("SELECT state FROM tasks WHERE id = ?")
    .get(taskId) as { state: string } | undefined;
  return row?.state;
}

async function seedTask(id: string, sessionId: string | null = null) {
  await db
    .insert(users)
    .values({ id: "u-run", email: "run@test.local" })
    .onConflictDoNothing();
  await db
    .insert(agents)
    .values({
      id: "a-run",
      slug: "run-agent",
      name: "Run",
      ownerId: "u-run",
    })
    .onConflictDoNothing();
  await db
    .insert(agentReleases)
    .values({
      id: "rel-run",
      agentId: "a-run",
      version: "1.0.0",
      immutablePackagePath: "/tmp",
      checksum: "c",
      publishedBy: "u-run",
    })
    .onConflictDoNothing();
  await db
    .insert(tasks)
    .values({
      id,
      ownerId: "u-run",
      agentReleaseId: "rel-run",
      sessionId,
    })
    .onConflictDoNothing();
}

function makeScheduler(
  handler: (t: ClaimedTask) => Promise<HandlerOutcome>,
  maxConcurrency: number,
) {
  return new Scheduler(
    {
      claim: (owner, seconds) => claimNextTask(db, owner, seconds),
      finish: (taskId, owner, state) => finishLeasedTask(db, taskId, owner, state),
      reclaim: () => reclaimStaleLeases(db),
    },
    handler,
    { pollIntervalMs: 10_000, maxConcurrency, leaseSeconds: 60 },
  );
}

describe("runner scheduler (task 2.1)", () => {
  it("executes claimed tasks to completion", async () => {
    await seedTask("sch-1", "s-1");
    const handled: string[] = [];
    const scheduler = makeScheduler(async (t) => {
      handled.push(t.id);
      return "completed";
    }, 5);
    await scheduler.tick();
    expect(handled).toEqual(["sch-1"]);
    expect(stateOf("sch-1")).toBe("completed");
  });

  it("handler failures map to failed", async () => {
    await seedTask("sch-2", "s-2");
    const scheduler = makeScheduler(async () => {
      throw new Error("boom");
    }, 5);
    await scheduler.tick();
    expect(stateOf("sch-2")).toBe("failed");
  });

  it("honours the concurrency cap", async () => {
    await seedTask("sch-3a", "s-3a");
    await seedTask("sch-3b", "s-3b");
    await seedTask("sch-3c", "s-3c");
    let inFlight = 0;
    let peak = 0;
    const scheduler = makeScheduler(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 25));
      inFlight -= 1;
      return "completed";
    }, 2);
    await scheduler.tick();
    expect(peak).toBeLessThanOrEqual(2);
    for (const id of ["sch-3a", "sch-3b", "sch-3c"]) {
      expect(stateOf(id)).toBe("completed");
    }
  });
});
