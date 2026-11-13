/**
 * C2/C3/W3 verification (runner side): usage records, observability fields,
 * token budget termination.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createTestDb, rawExec, rawQuery, users } from "@forgegent/db";
import type { ForgegentDb } from "@forgegent/db";
import {
  createDraft,
  reviewDraft,
  ReleaseStore,
  submitDraft,
} from "@forgegent/registry";
import { executeRestrictedTask } from "../src/executor.js";

const db: ForgegentDb = createTestDb();
const releasesDir = mkdtempSync(join(tmpdir(), "obs-rel-"));
const store = new ReleaseStore(releasesDir);
store.init();

const admin = "obs-admin";
const builder = "obs-builder";
const employee = "obs-emp";

afterAll(() => {
  try {
    rmSync(releasesDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

async function setup(): Promise<string> {
  await db.insert(users).values({ id: admin, email: "a@o.local" }).onConflictDoNothing();
  await db.insert(users).values({ id: builder, email: "b@o.local" }).onConflictDoNothing();
  await db.insert(users).values({ id: employee, email: "e@o.local" }).onConflictDoNothing();
  const draft = await createDraft(db, {
    builderId: builder,
    slug: `obs-agent-${crypto.randomUUID().slice(0, 6)}`,
    payload: {
      schemaVersion: "1.0",
      name: "O",
      description: "x",
      version: "1.0.0",
      ui: { type: "form-result", schema: { fields: [] } },
      runtime: { engine: "pi-coding-agent", mode: "restricted" },
    },
  });
  await submitDraft(db, { draftId: draft.draftId, builderId: builder });
  const published = await reviewDraft(db, store, {
    draftId: draft.draftId,
    adminId: admin,
    decision: "approve",
  });
  if (!("releaseId" in published)) throw new Error("publish failed");
  rawExec(
    db,
    "INSERT OR REPLACE INTO resources (id, kind, name, config) VALUES ('ep-obs', 'model_endpoint', 'default', ?)",
    JSON.stringify({ baseUrl: "https://m.local/v1", model: "obs-model", apiKeyEnv: "X" }),
  );
  return published.releaseId;
}

describe("C2/C3 — usage records + observability fields", () => {
  it("completed tasks record usage + requestId/durationMs/toolCalls in events", async () => {
    const releaseId = await setup();
    rawExec(
      db,
      "INSERT OR REPLACE INTO tasks (id, owner_id, agent_release_id, state, origin, mode, session_id) VALUES ('obs-task', ?, ?, 'running', 'staff', 'restricted', 's-obs')",
      employee,
      releaseId,
    );
    const outcome = await executeRestrictedTask(db, store, {
      id: "obs-task",
      ownerId: employee,
      agentReleaseId: releaseId,
      state: "running",
      origin: "staff",
      mode: "restricted",
      inputSummary: "生成一张海报",
      sessionId: "s-obs",
      budget: null,
    }, {
      runAgent: async () => "海报已生成（obs mock 输出，足够长度以产生 token 估算）",
      saveArtifact: async () => ({ id: "f" }),
    });
    expect(outcome).toBe("completed");
    const usage = rawQuery<{ model: string; input_tokens: number; output_tokens: number }>(
      db,
      "SELECT model, input_tokens, output_tokens FROM usage_records WHERE task_id = 'obs-task'",
    );
    expect(usage).toHaveLength(1);
    expect(usage[0]!.model).toBe("obs-model");
    expect(usage[0]!.input_tokens + usage[0]!.output_tokens).toBeGreaterThan(0);
    const events = rawQuery<{ event_type: string; safe_payload: string }>(
      db,
      "SELECT event_type, safe_payload FROM task_events WHERE task_id = 'obs-task'",
    );
    const started = JSON.parse(events.find((e) => e.event_type === "run.started")!.safe_payload);
    const completed = JSON.parse(events.find((e) => e.event_type === "run.completed")!.safe_payload);
    expect(started.requestId).toBeTruthy();
    expect(started.releaseId).toBe(releaseId);
    expect(completed.durationMs).toBeGreaterThanOrEqual(0);
    expect(completed.toolCalls).toBeGreaterThanOrEqual(0);
    expect(completed.model).toBe("obs-model");
  });

  it("W3: token budget exceeded -> failed with structured reason + usage row", async () => {
    const releaseId = await setup();
    rawExec(
      db,
      "INSERT OR REPLACE INTO tasks (id, owner_id, agent_release_id, state, origin, mode, session_id, budget) VALUES ('obs-budget', ?, ?, 'running', 'staff', 'restricted', 's-ob', ?)",
      employee,
      releaseId,
      JSON.stringify({ maxTokens: 1 }),
    );
    const outcome = await executeRestrictedTask(db, store, {
      id: "obs-budget",
      ownerId: employee,
      agentReleaseId: releaseId,
      state: "running",
      origin: "staff",
      mode: "restricted",
      inputSummary: "超预算输入",
      sessionId: "s-ob",
      budget: JSON.stringify({ maxTokens: 1 }),
    }, {
      runAgent: async () => "输出",
      saveArtifact: async () => ({ id: "f" }),
    });
    expect(outcome).toBe("failed");
    const events = rawQuery<{ event_type: string; safe_payload: string }>(
      db,
      "SELECT event_type, safe_payload FROM task_events WHERE task_id = 'obs-budget'",
    );
    const fail = JSON.parse(events.find((e) => e.event_type === "run.failed")!.safe_payload);
    expect(fail.errorType).toBe("token-budget-exceeded");
    expect(fail.reason).toContain("预算超限");
    expect(
      rawQuery<{ id: string }>(db, "SELECT id FROM usage_records WHERE task_id = 'obs-budget'"),
    ).toHaveLength(1);
  });
});
