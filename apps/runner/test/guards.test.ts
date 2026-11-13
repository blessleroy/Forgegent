import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  appendTaskEvent,
  createTestDb,
  readTaskEvents,
  rawExec,
  users,
} from "@forgegent/db";
import type { ForgegentDb } from "@forgegent/db";
import { LocalProcessBackend, SandboxManager } from "@forgegent/sandbox";
import {
  executeGuardedTask,
  isCancelledBeforeRun,
  runGuarded,
} from "../src/guards.js";

const db: ForgegentDb = createTestDb();
const tmpDirs: string[] = [];
afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

function fakeTask(overrides: Partial<{ id: string; sessionId: string; state: string }> = {}) {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    ownerId: "guard-owner",
    agentReleaseId: "rel",
    state: overrides.state ?? "starting",
    origin: "staff",
    mode: "sandboxed",
    inputSummary: null,
    sessionId: overrides.sessionId ?? crypto.randomUUID(),
    budget: null,
  };
}

async function seedTaskRow(id: string, state = "starting") {
  await db.insert(users).values({ id: "guard-owner", email: "g@g.local" }).onConflictDoNothing();
  rawExec(
    db,
    "INSERT OR IGNORE INTO agents (id, slug, name, owner_id) VALUES ('guard-agent', 'guard-agent', 'G', 'guard-owner')",
  );
  rawExec(
    db,
    "INSERT OR IGNORE INTO agent_releases (id, agent_id, version, immutable_package_path, checksum, published_by) VALUES ('rel', 'guard-agent', '1.0.0', '/tmp', 'c', 'guard-owner')",
  );
  rawExec(
    db,
    "INSERT OR REPLACE INTO tasks (id, owner_id, agent_release_id, state, origin, mode, session_id) VALUES (?, 'guard-owner', 'rel', ?, 'staff', 'sandboxed', ?)",
    id,
    state,
    crypto.randomUUID(),
  );
  appendTaskEvent(db, id, "run.started", {});
}

describe("execution guards (task 7.6)", () => {
  it("deadline exceeded -> failed with structured reason + sandbox torn down", async () => {
    const task = fakeTask();
    await seedTaskRow(task.id, "running");
    const persist = mkdtempSync(join(tmpdir(), "guard-p-"));
    tmpDirs.push(persist);
    const backend = new LocalProcessBackend(mkdtempSync(join(tmpdir(), "guard-b-")));
    const manager = new SandboxManager(backend, persist);
    const outcome = await runGuarded(db, task, {
      timeoutMs: 50,
      sandbox: manager,
      run: async () => {
        await new Promise((r) => setTimeout(r, 5000));
        return "completed" as const;
      },
    });
    expect(outcome).toBe("failed");
    const events = readTaskEvents(db, task.id);
    const fail = events.find((e) => e.eventType === "run.failed");
    expect((fail!.safePayload as { reason: string }).reason).toContain(
      "exceeded time budget",
    );
    // Sandbox session no longer live (torn down on the failure path).
    expect(manager.has(task.sessionId!)).toBe(false);
  });

  it("cancel-before-run skips execution and closes the lease as cancelled", async () => {
    const task = fakeTask();
    await seedTaskRow(task.id, "cancelled");
    expect(isCancelledBeforeRun(db, task.id)).toBe(true);
    let ran = false;
    await executeGuardedTask(db, task, "owner-1", {
      timeoutMs: 1000,
      run: async () => {
        ran = true;
        return "completed";
      },
    });
    expect(ran).toBe(false);
    const state = db.$client
      .prepare("SELECT state FROM tasks WHERE id = ?")
      .get(task.id) as { state: string };
    expect(state.state).toBe("cancelled");
    const events = readTaskEvents(db, task.id);
    expect(events.some((e) => e.eventType === "task.skipped")).toBe(true);
  });

  it("waiting_input does not trip the deadline (active run only)", async () => {
    const task = fakeTask();
    await seedTaskRow(task.id, "running");
    const outcome = await runGuarded(db, task, {
      timeoutMs: 5_000,
      run: async () => "waiting_input" as const,
    });
    expect(outcome).toBe("waiting_input");
    const events = readTaskEvents(db, task.id);
    expect(events.some((e) => e.eventType === "run.failed")).toBe(false);
  });
});
