/**
 * M1 acceptance E2E (task 4.8, AT-04): seed -> employee creates a poster
 * task -> runner executes (mock agent) -> artifact lands in the employee's
 * file space -> SSE event history is complete and resumable (AT-12 support).
 */
import { chmodSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, readTaskEvents, users } from "@forgegent/db";
import type { ForgegentDb } from "@forgegent/db";
import { seedDemo, listAgentsForUser } from "@forgegent/registry";
import { ReleaseStore } from "@forgegent/registry";
import { FileStore } from "@forgegent/storage/src/index.js";
import { createTask, getTaskForUser } from "@forgegent/tasks";
import { Scheduler } from "../src/scheduler.js";
import { executeRestrictedTask } from "../src/executor.js";
import { claimNextTask, finishLeasedTask, reclaimStaleLeases } from "@forgegent/db";

const db: ForgegentDb = createTestDb();
let releasesDir: string;
let filesDir: string;
let store: ReleaseStore;

beforeAll(() => {
  releasesDir = mkdtempSync(join(tmpdir(), "m1-rel-"));
  filesDir = mkdtempSync(join(tmpdir(), "m1-files-"));
  store = new ReleaseStore(releasesDir);
  store.init();
});

afterAll(() => {
  for (const dir of [releasesDir, filesDir]) {
    try {
      chmodSync(dir, 0o755);
      for (const entry of readdirSync(dir)) {
        try {
          chmodSync(join(dir, entry), 0o755);
        } catch {
          /* best effort */
        }
      }
    } catch {
      /* best effort */
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("M1 acceptance (task 4.8 — AT-04 flow with mock agent)", () => {
  it("seed → task → runner execution → artifact in personal space", async () => {
    // Seed (D25): demo accounts + published poster agent + endpoint resource.
    const ids = new Map<string, string>();
    await seedDemo(
      db,
      store,
      {
        accounts: {
          adminEmail: "admin@m1.local",
          adminPassword: "init-pass-123",
          builderEmail: "builder@m1.local",
          builderPassword: "demo-builder-123",
          employeeEmail: "employee@m1.local",
          employeePassword: "demo-employee-123",
        },
        modelEndpoint: {
          baseUrl: "https://mock.local/v1",
          model: "mock-image",
          apiKeyEnv: "MOCK_KEY",
        },
      },
      async (email, _password, name) => {
        const id = crypto.randomUUID();
        ids.set(email, id);
        await db.insert(users).values({ id, email, name }).onConflictDoNothing();
        return { id };
      },
    );
    const employeeId = ids.get("employee@m1.local")!;

    // Employee sees exactly the seeded agent (authorization filtered).
    const agents = await listAgentsForUser(db, {
      userId: employeeId,
      roles: ["employee"],
    });
    expect(agents).toHaveLength(1);
    expect(agents[0]!.slug).toBe("poster-designer");

    // Task creation binds the active release.
    const task = await createTask(db, {
      ownerId: employeeId,
      roles: ["employee"],
      agentId: agents[0]!.id,
      inputSummary: "主题: 秋季大促\n风格: 简约",
    });
    expect(task.state).toBe("pending");

    // Runner executes with a mock agent + real FileStore artifact wiring.
    const fileStore = new FileStore(filesDir, db);
    const scheduler = new Scheduler(
      {
        claim: (owner, seconds) => claimNextTask(db, owner, seconds),
        finish: (taskId, owner, state) => finishLeasedTask(db, taskId, owner, state),
        reclaim: () => reclaimStaleLeases(db),
      },
      async (claimed) => {
        const outcome = await executeRestrictedTask(db, store, claimed, {
          runAgent: async ({ userMessage }) => {
            expect(userMessage).toContain("秋季大促");
            return "已生成海报（mock agent 输出）";
          },
          saveArtifact: (ownerId, taskId, filename, mime, bytes) =>
            fileStore.put({ ownerId, filename, mime, bytes, taskId }),
          trackArtifactSource: () => undefined,
          collectArtifacts: () => [
            { mime: "image/png", bytes: Buffer.from("fake-png-bytes") },
          ],
        });
        return outcome;
      },
      { pollIntervalMs: 60_000, maxConcurrency: 5, leaseSeconds: 60 },
    );
    await scheduler.tick();

    const done = await getTaskForUser(db, {
      taskId: task.id,
      userId: employeeId,
      roles: ["employee"],
    });
    const evs = readTaskEvents(db, task.id);
    console.log("EVLIST:", evs.map((e) => e.eventType + "=" + JSON.stringify(e.safePayload).slice(0, 300)).join(","));
    expect(done.state).toBe("completed");
    expect(evs.map((e) => e.eventType)).toEqual([
      "task.created",
      "run.started",
      "release.loaded",
      "agent.output",
      "artifact.saved",
      "run.completed",
    ]);

    // Artifact landed in the employee's personal space, listed and owned.
    const files = await fileStore.list(employeeId);
    expect(files).toHaveLength(1);
    expect(files[0]!.filename).toMatch(/^artifact-1\.0\.0-1\.png$/);

    // Event history is complete and resumable by seq (SSE resume semantics).
    const events = readTaskEvents(db, task.id);
    const types = events.map((e) => e.eventType);
    expect(types).toContain("release.loaded");
    expect(types).toContain("agent.output");
    expect(types).toContain("artifact.saved");
    expect(types).toContain("run.completed");
    const afterArtifact = readTaskEvents(
      db,
      task.id,
      events.find((e) => e.eventType === "release.loaded")!.seq,
    );
    expect(afterArtifact.length).toBe(events.length - 3);
  });

  it("fails clearly when no model endpoint is configured", async () => {
    const freshDb = createTestDb();
    const freshStore = new ReleaseStore(mkdtempSync(join(tmpdir(), "m1-norel-")));
    freshStore.init();
    const ids = new Map<string, string>();
    await seedDemo(
      freshDb,
      freshStore,
      {
        accounts: {
          adminEmail: "admin@x.local",
          adminPassword: "init-pass-123",
          builderEmail: "builder@x.local",
          builderPassword: "demo-builder-123",
          employeeEmail: "employee@x.local",
          employeePassword: "demo-employee-123",
        },
        // No modelEndpoint configured.
      },
      async (email, _p, name) => {
        const id = crypto.randomUUID();
        ids.set(email, id);
        await freshDb.insert(users).values({ id, email, name }).onConflictDoNothing();
        return { id };
      },
    );
    const employeeId = ids.get("employee@x.local")!;
    const agent = (
      await listAgentsForUser(freshDb, {
        userId: employeeId,
        roles: ["employee"],
      })
    )[0]!;
    const task = await createTask(freshDb, {
      ownerId: employeeId,
      roles: ["employee"],
      agentId: agent.id,
      inputSummary: "x",
    });
    const outcome = await executeRestrictedTask(freshDb, freshStore, {
      id: task.id,
      ownerId: employeeId,
      agentReleaseId: task.agentReleaseId,
      state: "starting",
      origin: "staff",
      mode: "restricted",
      inputSummary: "x",
      sessionId: task.sessionId,
      budget: null,
    }, {
      runAgent: async () => "unused",
      saveArtifact: async () => ({ id: "x" }),
    });
    expect(outcome).toBe("failed");
    const events = readTaskEvents(freshDb, task.id);
    const fail = events.find((e) => e.eventType === "run.failed");
    expect((fail!.safePayload as { reason: string }).reason).toContain("未配置");
  });
});
