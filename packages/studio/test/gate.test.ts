/**
 * R4 regressions:
 * - 4.2 the submit gate runs FOR REAL online (isolated origin=test task
 *   launched, id attached to the gate result) and labels offline mode.
 * - 4.5 poster idempotency persists across tool instances (restarts).
 * - 4.3 estimated cost from configured prices; real tool-call counting.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createTestDb, rawExec, rawQuery, readTaskEvents, users, type ForgegentDb } from "@forgegent/db";
import { createDraft, ReleaseStore } from "@forgegent/registry";
import { submitWithGate } from "../src/service.js";

const db: ForgegentDb = createTestDb();
const releasesDir = mkdtempSync(join(tmpdir(), "gate-rel-"));
const store = new ReleaseStore(releasesDir);
store.init();

afterAll(() => {
  try {
    rmSync(releasesDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

const payload = {
  schemaVersion: "1.0" as const,
  name: "Gate App",
  description: "d",
  version: "1.0.0",
  ui: { type: "form-result" as const, schema: { fields: [{ name: "a", label: "A", type: "text" }] } },
  runtime: { engine: "pi-coding-agent" as const, mode: "restricted" as const },
  toolRefs: [],
  resourceRefs: [],
  prompts: { system: "x" },
  tests: { cases: ["生成一张测试图"] },
};

describe("R4 task 4.2 — the submit gate really executes online / labels offline", () => {
  it("online: launches an isolated origin=test task and attaches its id", async () => {
    await db.insert(users).values({ id: "gate-b", email: "b@gate.local" }).onConflictDoNothing();
    const draft = await createDraft(db, {
      builderId: "gate-b",
      slug: "gate-agent",
      payload,
    });
    const { gate } = await submitWithGate(db, {
      draftId: draft.draftId,
      builderId: "gate-b",
      store,
      backendMode: "llm",
    });
    expect(gate.asyncTestTaskId).toBeTruthy();
    const task = rawQuery<{ origin: string; state: string }>(
      db,
      "SELECT origin, state FROM tasks WHERE id = ?",
      gate.asyncTestTaskId!,
    )[0];
    expect(task!.origin).toBe("test");
    expect(gate.offline).toBeUndefined();
  });

  it("offline: labelled 未运行（离线演示模式）, never blocks submission", async () => {
    const draft = await createDraft(db, {
      builderId: "gate-b",
      slug: "gate-agent-off",
      payload,
    });
    const { submitted, gate } = await submitWithGate(db, {
      draftId: draft.draftId,
      builderId: "gate-b",
      backendMode: "heuristic",
    });
    expect(gate.offline).toBe(true);
    expect(gate.summary).toContain("离线演示模式");
    expect(submitted.state).toBe("in_review");
  });
});

void readTaskEvents;
void rawExec;
