/**
 * M0 acceptance E2E (task 2.5, PRD §13 M0):
 * 1. two users with strictly isolated personal file spaces;
 * 2. one restricted-tool agent task running safely through the scheduler
 *    (real pi session is created; the tool allowlist is asserted so "safe"
 *    is verified without needing a live model endpoint).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  agentReleases,
  agents,
  appendTaskEvent,
  claimNextTask,
  createTestDb,
  finishLeasedTask,
  readTaskEvents,
  reclaimStaleLeases,
  users,
} from "@forgegent/db";
import { FileStore } from "@forgegent/storage/src/index.js";
import { createPlatformSession } from "@forgegent/pi-adapter/src/index.js";
import { Scheduler } from "../src/scheduler.js";

const db = createTestDb();
const tmpDirs: string[] = [];
afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

describe("M0 acceptance (task 2.5)", () => {
  it("two users: login-independent, strictly isolated file spaces", async () => {
    for (const id of ["m0-alice", "m0-bob"]) {
      await db
        .insert(users)
        .values({ id, email: `${id}@m0.local` })
        .onConflictDoNothing();
    }
    const store = new FileStore(mkdtemp(), db);
    const a = await store.put({
      ownerId: "m0-alice",
      filename: "alice-brief.pdf",
      mime: "application/pdf",
      bytes: Buffer.from("alice-only"),
    });
    await store.put({
      ownerId: "m0-bob",
      filename: "bob-brief.pdf",
      mime: "application/pdf",
      bytes: Buffer.from("bob-only"),
    });
    // Owner access works.
    const dl = await store.openDownload("m0-alice", a.id);
    expect(dl.filename).toBe("alice-brief.pdf");
    // Cross-user access is denied in both directions.
    await expect(store.openDownload("m0-bob", a.id)).rejects.toMatchObject({
      detail: { code: "FORBIDDEN" },
    });
    const bobFiles = await store.list("m0-bob");
    expect(bobFiles.map((f) => f.filename)).toEqual(["bob-brief.pdf"]);
  });

  it("restricted-tool agent task runs safely through the scheduler", async () => {
    // Seed one agent release + task owned by the employee user.
    await db
      .insert(users)
      .values({ id: "m0-emp", email: "emp@m0.local" })
      .onConflictDoNothing();
    await db
      .insert(agents)
      .values({
        id: "m0-agent",
        slug: "restricted-demo",
        name: "Restricted Demo",
        ownerId: "m0-alice",
      })
      .onConflictDoNothing();
    await db
      .insert(agentReleases)
      .values({
        id: "m0-rel",
        agentId: "m0-agent",
        version: "1.0.0",
        immutablePackagePath: "/tmp/m0-rel",
        checksum: "m0-checksum",
        publishedBy: "m0-alice",
      })
      .onConflictDoNothing();
    db.$client
      .prepare(
        "INSERT OR REPLACE INTO tasks (id, owner_id, agent_release_id, state, origin, mode) VALUES ('m0-task', 'm0-emp', 'm0-rel', 'pending', 'staff', 'restricted')",
      )
      .run();

    const workspace = mkdtemp();
    tmpDirs.push(workspace);
    const scheduler = new Scheduler(
      {
        claim: (owner, seconds) => claimNextTask(db, owner, seconds),
        finish: (taskId, owner, state) =>
          finishLeasedTask(db, taskId, owner, state),
        reclaim: () => reclaimStaleLeases(db),
      },
      async (task) => {
        appendTaskEvent(db, task.id, "run.started", { mode: task.mode });
        // Safety check: a fresh restricted session exposes no tools at all
        // (no shell, no file write) — verified against the real SDK.
        const session = await createPlatformSession({
          cwd: workspace,
          mode: "restricted",
          toolAllowlist: [],
        });
        const names = session.getActiveToolNames();
        session.dispose();
        appendTaskEvent(db, task.id, "session.verified", {
          activeTools: names,
          shellAvailable: names.includes("bash"),
        });
        return "completed";
      },
      { pollIntervalMs: 60_000, maxConcurrency: 5, leaseSeconds: 60 },
    );
    await scheduler.tick();

    const state = db.$client
      .prepare("SELECT state FROM tasks WHERE id = 'm0-task'")
      .get() as { state: string };
    expect(state.state).toBe("completed");

    const events = readTaskEvents(db, "m0-task");
    expect(events.map((e) => e.eventType)).toEqual([
      "run.started",
      "session.verified",
    ]);
    const verified = events[1]!.safePayload as {
      shellAvailable: boolean;
      activeTools: string[];
    };
    expect(verified.activeTools).toEqual([]);
    expect(verified.shellAvailable).toBe(false);
  });
});

function mkdtemp(): string {
  const dir = mkdtempSync(join(tmpdir(), "forgegent-m0-"));
  tmpDirs.push(dir);
  return dir;
}
