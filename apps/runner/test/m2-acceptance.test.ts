/**
 * M2 acceptance E2E (task 6.6): natural language → draft → modify → gate →
 * review → publish → employee uses the app. No manual code changes anywhere
 * in the chain; executor deps are mocked (agent loop arrives with the real
 * model endpoint).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, readTaskEvents, users } from "@forgegent/db";
import type { ForgegentDb } from "@forgegent/db";
import {
  listAgentsForUser,
  ReleaseStore,
  reviewDraft,
  setAgentGrants,
} from "@forgegent/registry";
import { createTask, getTaskForUser } from "@forgegent/tasks";
import { executeRestrictedTask } from "../src/executor.js";
import {
  continueConversation,
  HeuristicBuilderAgent,
  startConversation,
  submitWithGate,
} from "@forgegent/studio";
import { claimNextTask, finishLeasedTask, rawExec } from "@forgegent/db";
import { Scheduler } from "../src/scheduler.js";
import { FileStore } from "@forgegent/storage/src/index.js";

const db: ForgegentDb = createTestDb();
const releasesDir = mkdtempSync(join(tmpdir(), "m2-rel-"));
const filesDir = mkdtempSync(join(tmpdir(), "m2-files-"));
const store = new ReleaseStore(releasesDir);
store.init();

const builder = "m2-builder";
const admin = "m2-admin";
const employee = "m2-employee";

beforeAll(async () => {
  for (const [id, email] of [
    [builder, "builder@m2.local"],
    [admin, "admin@m2.local"],
    [employee, "employee@m2.local"],
  ] as const) {
    await db.insert(users).values({ id, email }).onConflictDoNothing();
  }
  rawExec(
    db,
    "INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'role-builder'), (?, 'role-admin'), (?, 'role-employee')",
    builder,
    admin,
    employee,
  );
  rawExec(
    db,
    "INSERT OR REPLACE INTO resources (id, kind, name, config) VALUES ('ep', 'model_endpoint', 'default', ?)",
    JSON.stringify({ baseUrl: "https://mock.local/v1", model: "mock", apiKeyEnv: "X" }),
  );
});

afterAll(() => {
  for (const dir of [releasesDir, filesDir]) {
    try {
      for (const entry of readdirSafe(dir)) chmodSafe(join(dir, entry));
      chmodSafe(dir);
    } catch {
      /* best effort */
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

function readdirSafe(dir: string): string[] {
  try {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    return readdirSync(dir);
  } catch {
    return [];
  }
}
function chmodSafe(path: string): void {
  try {
    const { chmodSync } = require("node:fs") as typeof import("node:fs");
    chmodSync(path, 0o755);
  } catch {
    /* best effort */
  }
}

describe("M2 acceptance (task 6.6 — full studio loop)", () => {
  it("language → draft → modify → gate → review → publish → employee task", async () => {
    const backend = new HeuristicBuilderAgent();

    // 1. Builder describes the app in natural language (AT-01).
    const created = await startConversation(db, backend, {
      builderId: builder,
      slug: "m2-poster",
      brief: "创建一个活动海报 Agent，员工输入主题和风格，用生图模型出图",
    });
    expect(created.message.text).toContain("form-result");

    // 2. Iterates through conversation (AT-02).
    const modified = await continueConversation(db, backend, {
      draftId: created.draftId,
      builderId: builder,
      instruction: "增加参考图上传，改为 9:16 竖版",
    });
    expect(modified.message.changes?.join(" ")).toContain("参考图");

    // 3. Submit with the automatic gate (N5).
    const { submitted, gate } = await submitWithGate(db, {
      draftId: created.draftId,
      builderId: builder,
    });
    expect(submitted.state).toBe("in_review");
    expect(gate.passed).toBe(true);

    // 4. Admin approves → immutable release (published without touching
    //    source code anywhere).
    const published = await reviewDraft(db, store, {
      draftId: created.draftId,
      adminId: admin,
      decision: "approve",
    });
    expect("releaseId" in published).toBe(true);

    // 5. Grant the whole company, employee sees and uses the app.
    await setAgentGrants(db, {
      agentId: created.agentId,
      grants: [{ subjectType: "all_users" }],
    });
    const visible = await listAgentsForUser(db, {
      userId: employee,
      roles: ["employee"],
    });
    const app = visible.find((a) => a.slug === "m2-poster");
    expect(app).toBeTruthy();

    // 6. Employee task executes through the runner (mock agent loop).
    const task = await createTask(db, {
      ownerId: employee,
      roles: ["employee"],
      agentId: created.agentId,
      inputSummary: "主题: 年会 / 风格: 喜庆",
    });
    const fileStore = new FileStore(filesDir, db);
    const scheduler = new Scheduler(
      {
        claim: (owner, seconds) => claimNextTask(db, owner, seconds),
        finish: (taskId, owner, state) => finishLeasedTask(db, taskId, owner, state),
        reclaim: () => [],
      },
      async (claimed) =>
        executeRestrictedTask(db, store, claimed, {
          runAgent: async ({ userMessage }) => `已生成海报：${userMessage.split("\n")[0]}`,
          saveArtifact: (ownerId, taskId, filename, mime, bytes) =>
            fileStore.put({ ownerId, filename, mime, bytes, taskId }),
        }),
      { pollIntervalMs: 60_000, maxConcurrency: 5, leaseSeconds: 60 },
    );
    await scheduler.tick();

    const done = await getTaskForUser(db, {
      taskId: task.id,
      userId: employee,
      roles: ["employee"],
    });
    expect(done.state).toBe("completed");
    const events = readTaskEvents(db, task.id).map((e) => e.eventType);
    expect(events).toContain("artifact.saved");
    expect((await fileStore.list(employee)).length).toBe(1);
  });
});
