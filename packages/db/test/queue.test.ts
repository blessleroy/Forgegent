import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  claimNextTask,
  finishLeasedTask,
  newLeaseOwnerId,
  reclaimStaleLeases,
  renewLease,
} from "../src/queue.js";
import {
  agentReleases,
  agents,
  tasks,
  users,
} from "../src/schema.js";
import { createTestDb } from "../src/index.js";

async function seedTask(
  db: ReturnType<typeof createTestDb>,
  overrides: Partial<{
    taskId: string;
    state: string;
    sessionId: string | null;
    leaseUntil: number | null;
    leaseOwner: string | null;
  }> = {},
) {
  const taskId = overrides.taskId ?? crypto.randomUUID();
  await db
    .insert(users)
    .values({
      id: "queue-user",
      email: "queue@test.local",
      passwordHash: null,
    })
    .onConflictDoNothing();
  await db
    .insert(agents)
    .values({
      id: "queue-agent",
      slug: `agent-${taskId.slice(0, 8)}`,
      name: "Queue Agent",
      ownerId: "queue-user",
    })
    .onConflictDoNothing();
  await db
    .insert(agentReleases)
    .values({
      id: "queue-release",
      agentId: "queue-agent",
      version: "1.0.0",
      immutablePackagePath: "/tmp/pkg",
      checksum: "abc",
      publishedBy: "queue-user",
    })
    .onConflictDoNothing();
  await db.insert(tasks).values({
    id: taskId,
    ownerId: "queue-user",
    agentReleaseId: "queue-release",
    state: overrides.state ?? "pending",
    sessionId: overrides.sessionId ?? null,
    leaseUntil:
      overrides.leaseUntil !== undefined && overrides.leaseUntil !== null
        ? new Date(overrides.leaseUntil)
        : null,
    leaseOwner: overrides.leaseOwner ?? null,
  });
  return taskId;
}

describe("task queue leases (task 2.1 — task-execution spec)", () => {
  it("claims pending tasks atomically — no double claim", async () => {
    const db = createTestDb();
    const t1 = await seedTask(db, { taskId: "task-one" });
    const t2 = await seedTask(db, { taskId: "task-two" });
    const a = claimNextTask(db, "runner-a", 60);
    const b = claimNextTask(db, "runner-b", 60);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(new Set([a!.id, b!.id])).toEqual(new Set([t1, t2]));
    // Nothing left to claim.
    expect(claimNextTask(db, "runner-c", 60)).toBeNull();
  });

  it("session exclusive lock: second task of same session waits", async () => {
    const db = createTestDb();
    await seedTask(db, { taskId: "s1-a", sessionId: "sess-1" });
    await seedTask(db, { taskId: "s1-b", sessionId: "sess-1" });
    const first = claimNextTask(db, "runner-a", 60);
    expect(first!.id).toBe("s1-a");
    // Same session is locked while the first lease is alive.
    expect(claimNextTask(db, "runner-b", 60)).toBeNull();
    // Releasing the first lease unblocks the second.
    expect(finishLeasedTask(db, "s1-a", "runner-a", "completed")).toBe(true);
    const second = claimNextTask(db, "runner-b", 60);
    expect(second!.id).toBe("s1-b");
  });

  it("different sessions never block each other", async () => {
    const db = createTestDb();
    await seedTask(db, { taskId: "x-a", sessionId: "sess-x" });
    await seedTask(db, { taskId: "y-a", sessionId: "sess-y" });
    expect(claimNextTask(db, "r1", 60)!.id).toBe("x-a");
    expect(claimNextTask(db, "r2", 60)!.id).toBe("y-a");
  });

  it("renewLease only works for the owning runner", async () => {
    const db = createTestDb();
    await seedTask(db, { taskId: "renew-1", sessionId: "sess-r" });
    claimNextTask(db, "owner-1", 60);
    expect(renewLease(db, "renew-1", "owner-1", 60)).toBe(true);
    expect(renewLease(db, "renew-1", "owner-2", 60)).toBe(false);
  });

  it("stale leases are reclaimed as interrupted, never completed (AT-15)", async () => {
    const db = createTestDb();
    await seedTask(db, {
      taskId: "stale-1",
      state: "running",
      sessionId: "sess-s",
      leaseUntil: Date.now() - 1000,
      leaseOwner: "dead-runner",
    });
    const reclaimed = reclaimStaleLeases(db);
    expect(reclaimed).toEqual(["stale-1"]);
    const row = await db
      .select({ state: tasks.state })
      .from(tasks)
      .where(eq(tasks.id, "stale-1"))
      .get();
    expect(row!.state).toBe("interrupted");
    // Interrupted tasks are NOT auto-requeued: they await user continue
    // (D17) — the queue only hands out pending tasks.
    expect(claimNextTask(db, "runner-new", 60)).toBeNull();
  });

  it("lease ids are unique per runner", () => {
    expect(newLeaseOwnerId()).not.toBe(newLeaseOwnerId());
  });
});
