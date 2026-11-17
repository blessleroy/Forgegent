/**
 * R1 remediation regressions (tasks 1.2 / 1.7):
 * - cancel race: a run reporting success after user cancel must never
 *   overwrite `cancelled` (state-machine enforced at the queue layer);
 *   the refusal is visible as a task event, and the benign bookkeeping
 *   finish stays a silent no-op.
 * - event redaction: every persisted safe_payload passes through redact().
 */
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { finishLeasedTask } from "../src/queue.js";
import { appendTaskEvent, readTaskEvents } from "../src/events.js";
import { agentReleases, agents, tasks, users } from "../src/schema.js";
import { createTestDb } from "../src/index.js";

async function seedTask(
  db: ReturnType<typeof createTestDb>,
  overrides: Partial<{
    taskId: string;
    state: string;
    leaseUntil: number | null;
    leaseOwner: string | null;
  }> = {},
) {
  const taskId = overrides.taskId ?? crypto.randomUUID();
  await db
    .insert(users)
    .values({ id: "r1-user", email: "r1@test.local" })
    .onConflictDoNothing();
  await db
    .insert(agents)
    .values({
      id: "r1-agent",
      slug: `r1-agent-${taskId.slice(0, 8)}`,
      name: "R1 Agent",
      ownerId: "r1-user",
    })
    .onConflictDoNothing();
  await db
    .insert(agentReleases)
    .values({
      id: "r1-release",
      agentId: "r1-agent",
      version: "1.0.0",
      immutablePackagePath: "/tmp/pkg",
      checksum: "abc",
      publishedBy: "r1-user",
    })
    .onConflictDoNothing();
  await db.insert(tasks).values({
    id: taskId,
    ownerId: "r1-user",
    agentReleaseId: "r1-release",
    state: overrides.state ?? "pending",
    sessionId: null,
    leaseUntil:
      overrides.leaseUntil != null ? new Date(overrides.leaseUntil) : null,
    leaseOwner: overrides.leaseOwner ?? null,
  });
  return taskId;
}

describe("R1 task 1.2 — cancel race is closed at the queue layer", () => {
  it("a completed report after user cancel keeps cancelled and records the refusal", async () => {
    const db = createTestDb();
    const taskId = await seedTask(db, {
      state: "running",
      leaseOwner: "runner-a",
      leaseUntil: Date.now() + 60_000,
    });
    // User cancels mid-run (transition running -> cancelled; lease untouched
    // — exactly what cancelTask does via transitionTask).
    db.update(tasks).set({ state: "cancelled" }).where(eq(tasks.id, taskId)).run();

    // The still-running round later reports success:
    expect(finishLeasedTask(db, taskId, "runner-a", "completed")).toBe(false);

    const row = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    expect(row!.state).toBe("cancelled");
    expect(row!.leaseOwner).toBeNull();
    expect(row!.leaseUntil).toBeNull();

    const events = readTaskEvents(db, taskId);
    const refusal = events.find((e) => e.eventType === "task.finish_refused");
    expect(refusal).toBeDefined();
    const payload = refusal!.safePayload as { attempted: string; kept: string };
    expect(payload.attempted).toBe("completed");
    expect(payload.kept).toBe("cancelled");
  });

  it("bookkeeping finish after the lease was already closed is a silent no-op", async () => {
    const db = createTestDb();
    const taskId = await seedTask(db, {
      state: "running",
      leaseOwner: "runner-a",
      leaseUntil: Date.now() + 60_000,
    });
    // Normal path: the runner finished and closed its own lease.
    expect(finishLeasedTask(db, taskId, "runner-a", "completed")).toBe(true);
    // The scheduler's trailing bookkeeping call must not emit refusal noise.
    expect(finishLeasedTask(db, taskId, "runner-a", "completed")).toBe(false);
    const events = readTaskEvents(db, taskId);
    expect(events.some((e) => e.eventType === "task.finish_refused")).toBe(false);
  });

  it("queued-cancel path keeps cancelled and releases the lease", async () => {
    const db = createTestDb();
    const taskId = await seedTask(db, {
      state: "starting",
      leaseOwner: "runner-a",
      leaseUntil: Date.now() + 60_000,
    });
    // Cancelled between claim and run (starting -> cancelled), lease held.
    db.update(tasks).set({ state: "cancelled" }).where(eq(tasks.id, taskId)).run();
    expect(finishLeasedTask(db, taskId, "runner-a", "cancelled")).toBe(true);
    const row = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    expect(row!.state).toBe("cancelled");
    expect(row!.leaseOwner).toBeNull();
  });
});

describe("R1 task 1.7 — event payloads are redacted before persistence", () => {
  it("secret-shaped keys and values are masked for SSE and replay", async () => {
    const db = createTestDb();
    const taskId = await seedTask(db, {});
    appendTaskEvent(db, taskId, "agent.output", {
      text: "summary",
      apiKey: "not-a-real-key-but-long-hex-0123456789abcdef0123456789abcdef",
      nested: { authorization: "Bearer abc.def.ghi", safe: 42 },
      hint: "sk-live-abcdef1234567890abcdef1234567890",
    });
    const event = readTaskEvents(db, taskId).find(
      (e) => e.eventType === "agent.output",
    );
    expect(event).toBeDefined();
    const payload = event!.safePayload as Record<string, unknown> & {
      nested: Record<string, unknown>;
    };
    expect(payload.apiKey).toBe("[redacted]");
    expect(payload.nested.authorization).toBe("[redacted]");
    expect(payload.hint).toBe("[redacted]");
    expect(payload.nested.safe).toBe(42);
    expect(JSON.stringify(payload)).not.toContain("sk-live");
    expect(JSON.stringify(payload)).not.toContain("Bearer abc");
  });
});
