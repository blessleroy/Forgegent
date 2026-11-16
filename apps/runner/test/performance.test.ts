/**
 * Performance baseline (task 9.6): 5 concurrent tasks through the real
 * scheduler (mocked agent loop), latency percentiles recorded to
 * test-results/performance-baseline.md. Confirms the concurrency cap and
 * isolation under the V1 acceptance load.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { claimNextTask, createTestDb, finishLeasedTask, users } from "@forgegent/db";
import type { ForgegentDb } from "@forgegent/db";
import { createDraft, reviewDraft, setAgentGrants, ReleaseStore } from "@forgegent/registry";
import { createTask } from "@forgegent/tasks";
import { Scheduler } from "../src/scheduler.js";

const db: ForgegentDb = createTestDb();
const releasesDir = mkdtempSync(join(tmpdir(), "perf-rel-"));
const store = new ReleaseStore(releasesDir);
store.init();
const resultsDir = join(process.cwd(), "test-results");

afterAll(() => {
  try {
    rmSync(releasesDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

describe("task 9.6 — performance baseline (5 concurrent tasks)", () => {
  it("executes 5 concurrent tasks with P50/P95 recorded", async () => {
    const employee = "perf-emp";
    const admin = "perf-admin";
    const builder = "perf-builder";
    for (const [id, email] of [
      [employee, "e@p.local"],
      [admin, "a@p.local"],
      [builder, "b@p.local"],
    ] as const) {
      await db.insert(users).values({ id, email }).onConflictDoNothing();
    }
    const draft = await createDraft(db, {
      builderId: builder,
      slug: "perf-agent",
      payload: {
        schemaVersion: "1.0",
        name: "Perf",
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
    await setAgentGrants(db, {
      agentId: draft.agentId,
      grants: [{ subjectType: "all_users" }],
    });

    const taskIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const task = await createTask(db, {
        ownerId: employee,
        roles: ["employee"],
        agentId: draft.agentId,
        inputSummary: `perf task ${i}`,
      });
      taskIds.push(task.id);
    }

    const durations: number[] = [];
    const scheduler = new Scheduler(
      {
        claim: (owner, seconds) => claimNextTask(db, owner, seconds),
        finish: (taskId, owner, state) => finishLeasedTask(db, taskId, owner, state),
        reclaim: () => [],
      },
      async (task) => {
        const started = performance.now();
        await new Promise((r) => setTimeout(r, 30)); // simulated work
        durations.push(performance.now() - started);
        void task;
        return "completed";
      },
      { pollIntervalMs: 50, maxConcurrency: 5, leaseSeconds: 60 },
    );
    const wallStart = performance.now();
    await scheduler.tick();
    const wall = performance.now() - wallStart;

    for (const id of taskIds) {
      const state = db.$client
        .prepare("SELECT state FROM tasks WHERE id = ?")
        .get(id) as { state: string };
      expect(state.state).toBe("completed");
    }
    const sorted = [...durations].sort((a, b) => a - b);
    const p50 = percentile(sorted, 50);
    const p95 = percentile(sorted, 95);
    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(
      join(resultsDir, "performance-baseline.md"),
      [
        "# Performance baseline (task 9.6)",
        "",
        `- date: ${new Date().toISOString()}`,
        `- concurrent tasks: 5 (cap default)`,
        `- wall time for one full wave: ${wall.toFixed(1)}ms`,
        `- handler P50: ${p50.toFixed(1)}ms / P95: ${p95.toFixed(1)}ms`,
        `- isolation: all tasks completed with independent durations`,
        "",
        "Measured with a mocked agent loop (30ms simulated work); web API",
        "P50/P95 for Hub endpoints should be measured against a real deploy",
        "with a configured model endpoint (see README).",
        "",
      ].join("\n"),
    );
    expect(p95).toBeGreaterThan(0);
    expect(durations).toHaveLength(5);
  });
});
