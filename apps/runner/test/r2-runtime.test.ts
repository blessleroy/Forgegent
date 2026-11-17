/**
 * R2 2.11/2.12/2.13 regressions — the waiting_input ↔ resume loop:
 * - request_input tool → waiting_input outcome (run.suspended, session ref).
 * - continueTask queues the follow-up; the resumable claim delivers it and
 *   the next round's userMessage carries it to the model (AT-13 semantics).
 * - waiting_input releases the slot but keeps the session exclusive; the
 *   renewed lease keeps a live run safe from reclaim.
 * - timeout abort: the signal fires inside the run (task 1.2 尽力中止).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  createTestDb,
  claimNextTask,
  finishLeasedTask,
  reclaimStaleLeases,
  rawExec,
  readTaskEvents,
  renewLease,
  type ClaimedTask,
  type ForgegentDb,
} from "@forgegent/db";
import { ReleaseStore, type DraftPayload } from "@forgegent/registry";
import { continueTask } from "@forgegent/tasks";
import { executeRestrictedTask } from "../src/executor.js";
import { runGuarded } from "../src/guards.js";

const db: ForgegentDb = createTestDb();
const releasesDir = mkdtempSync(join(tmpdir(), "r2rt-rel-"));
const store = new ReleaseStore(releasesDir);
store.init();

afterAll(() => {
  try {
    rmSync(releasesDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

const payload: DraftPayload = {
  schemaVersion: "1.0",
  name: "方案生成专家",
  description: "doc agent",
  version: "1.0.0",
  ui: { type: "document-flow", schema: { uploadField: { name: "requirements", label: "需求", type: "textarea" }, outlineStage: { label: "大纲" }, progressStage: { label: "进度" }, downloadStage: { label: "下载" } } },
  runtime: { engine: "pi-coding-agent", mode: "restricted" },
  toolRefs: ["resources.search"],
};

function seedReleaseAndTask(taskId: string, sessionId = "sess-r2rt"): void {
  rawExec(db, "INSERT OR IGNORE INTO users (id, email) VALUES ('r2rt-emp', 'emp@r2rt.local')");
  rawExec(db, "INSERT OR IGNORE INTO agents (id, slug, name, owner_id) VALUES ('r2rt-agent', 'r2rt-doc-agent', 'Doc', 'r2rt-emp')");
  const existing = (
    db as unknown as { $client: { prepare(s: string): { get(...p: unknown[]): unknown } } }
  ).$client.prepare("SELECT id FROM agent_releases WHERE id = 'r2rt-rel'").get();
  if (!existing) {
    const snap = store.writeSnapshot({
      releaseId: "r2rt-rel",
      agentId: "r2rt-agent",
      version: "1.0.0",
      payload,
      publishedBy: "r2rt-emp",
    });
    rawExec(
      db,
      "INSERT OR IGNORE INTO agent_releases (id, agent_id, version, immutable_package_path, checksum, published_by) VALUES ('r2rt-rel', 'r2rt-agent', '1.0.0', ?, ?, 'r2rt-emp')",
      snap.releaseId,
      snap.checksum,
    );
  }
  rawExec(
    db,
    "INSERT OR IGNORE INTO resources (id, kind, name, config) VALUES ('r2rt-ep', 'model_endpoint', 'default', ?)",
    JSON.stringify({ baseUrl: "https://mock.local/v1", model: "mock-chat", apiKeyEnv: "R2RT_MOCK_KEY" }),
  );
  process.env.R2RT_MOCK_KEY = "k";
  rawExec(
    db,
    `INSERT OR REPLACE INTO tasks (id, owner_id, agent_release_id, state, session_id)
     VALUES (?, 'r2rt-emp', 'r2rt-rel', 'pending', ?)`,
    taskId,
    sessionId,
  );
}

function fakeDeps(behavior: {
  onRequestInput?: boolean;
  onUserMessage?: (msg: string) => void;
  sessionToAdopt?: string;
}) {
  return {
    async runAgent(input: {
      userMessage: string;
      tools: { name: string; execute: (args: Record<string, unknown>) => Promise<string> }[];
      onSessionId?: (id: string | null) => void;
    }) {
      behavior.onUserMessage?.(input.userMessage);
      input.onSessionId?.(behavior.sessionToAdopt ?? "pi-session-1");
      if (behavior.onRequestInput) {
        const tool = input.tools.find((t) => t.name === "request_input");
        await tool!.execute({ kind: "outline", message: "请确认大纲", summary: "一、背景 二、方案" });
      }
      return "大纲已生成，等待确认。";
    },
    loadSkills: () => ({ skills: [], diagnostics: [] }),
    collectArtifacts: () => [],
    trackArtifactSource: () => undefined,
    saveArtifact: async () => ({ id: "f" }),
  };
}

describe("R2 2.11/2.12 — waiting_input round-trip", () => {
  it("request_input suspends the run and persists the resumable session ref", async () => {
    seedReleaseAndTask("r2rt-1");
    const claimed = claimNextTask(db, "runner-a", 60)!;
    expect(claimed.id).toBe("r2rt-1");

    const outcome = await executeRestrictedTask(
      db,
      store,
      claimed,
      fakeDeps({ onRequestInput: true, sessionToAdopt: "pi-abc" }),
    );
    expect(outcome).toBe("waiting_input");
    const events = readTaskEvents(db, "r2rt-1");
    expect(events.map((e) => e.eventType)).toContain("agent.request_input");
    expect(events.map((e) => e.eventType)).toContain("run.suspended");
    // Session ref points at the per-task pi session directory (2.12).
    const ref = rawExec !== null ? true : true;
    void ref;
    const row = (
      db as unknown as { $client: { prepare(s: string): { get(...p: unknown[]): unknown } } }
    ).$client
      .prepare("SELECT session_path FROM session_refs WHERE task_id = 'r2rt-1'")
      .get() as { session_path: string };
    expect(row.session_path).toBe("work/r2rt-1/.pi-sessions/pi-abc");

    // Guard finishes the lease → slot released, state waiting_input.
    expect(finishLeasedTask(db, "r2rt-1", "runner-a", "waiting_input")).toBe(true);
  });

  it("continue queues the follow-up; the resumable claim delivers it to the model", async () => {
    // Employee replies to the waiting task (owner continue).
    await continueTask(db, {
      taskId: "r2rt-1",
      userId: "r2rt-emp",
      roles: ["employee"],
      message: "第二章展开成两章，再给我一版",
    });
    // continueTask flipped waiting_input -> running with no lease; the
    // resumable-claim path picks it up immediately — WITH the follow-up.
    const resumed = claimNextTask(db, "runner-b", 60)!;
    expect(resumed.id).toBe("r2rt-1");
    expect(resumed.state).toBe("running");
    expect(resumed.pendingFollowup).toContain("第二章展开成两章");
    // …and the follow-up row is consumed (claimed atomically).
    const cleared = (
      db as unknown as { $client: { prepare(s: string): { get(...p: unknown[]): unknown } } }
    ).$client
      .prepare("SELECT pending_followup FROM tasks WHERE id = 'r2rt-1'")
      .get() as { pending_followup: string | null };
    expect(cleared.pending_followup).toBeNull();

    // The next round's userMessage composes original input + follow-up.
    let seen = "";
    const outcome = await executeRestrictedTask(
      db,
      store,
      resumed,
      fakeDeps({ onUserMessage: (m) => (seen = m) }),
    );
    expect(outcome).toBe("completed");
    expect(seen).toContain("原始需求");
    expect(seen).toContain("第二章展开成两章");
    expect(readTaskEvents(db, "r2rt-1").map((e) => e.eventType)).toContain("run.round");
    finishLeasedTask(db, "r2rt-1", "runner-b", "completed");
  });

  it("a waiting task keeps its session exclusive for fresh tasks (D39)", () => {
    // Put r2rt-1 back into waiting_input (the previous round completed it).
    rawExec(db, "UPDATE tasks SET state = 'waiting_input', lease_owner = NULL, lease_until = NULL WHERE id = 'r2rt-1'");
    rawExec(
      db,
      `INSERT OR REPLACE INTO tasks (id, owner_id, agent_release_id, state, session_id)
       VALUES ('r2rt-2', 'r2rt-emp', 'r2rt-rel', 'pending', 'sess-r2rt')`,
    );
    // r2rt-1 is waiting_input with no lease — the same session still blocks.
    const blocked = claimNextTask(db, "runner-c", 60);
    expect(blocked).toBeNull();
    // A different session is unaffected.
    rawExec(
      db,
      `INSERT OR REPLACE INTO tasks (id, owner_id, agent_release_id, state, session_id)
       VALUES ('r2rt-3', 'r2rt-emp', 'r2rt-rel', 'pending', 'sess-other')`,
    );
    const other = claimNextTask(db, "runner-c", 60)!;
    expect(other.id).toBe("r2rt-3");
    finishLeasedTask(db, "r2rt-3", "runner-c", "completed");
  });
});

describe("R2 2.13 — leases outlive reclaim while renewed", () => {
  it("renewLease extends a live run past the original window; reclaim ignores it", () => {
    rawExec(
      db,
      `INSERT OR REPLACE INTO tasks (id, owner_id, agent_release_id, state, lease_owner, lease_until, session_id)
       VALUES ('r2rt-4', 'r2rt-emp', 'r2rt-rel', 'running', 'runner-x', ?, 'sess-4')`,
      Date.now() - 1000,
    );
    expect(renewLease(db, "r2rt-4", "runner-x", 60)).toBe(true);
    expect(reclaimStaleLeases(db)).not.toContain("r2rt-4");
  });
});

describe("R2 2.14 — authorized input copies reach the model and workspace", () => {
  it("text inputs join the prompt; delivery is recorded", async () => {
    seedReleaseAndTask("r2rt-6", "sess-inputs");
    const claimed = claimNextTask(db, "runner-in", 60)!;
    expect(claimed.id).toBe("r2rt-6");
    let seen = "";
    let workspaceFiles: { filename: string; mime: string; bytes: Buffer }[] = [];
    const outcome = await executeRestrictedTask(
      db,
      store,
      claimed,
      {
        ...fakeDeps({ onUserMessage: (m) => (seen = m) }),
        readInputFiles: async () => [
          {
            filename: "客户需求.txt",
            mime: "text/plain",
            bytes: Buffer.from("预算上限 50 万，目标行业：制造业"),
          },
          {
            filename: "brand.png",
            mime: "image/png",
            bytes: Buffer.from("binary-bytes"),
          },
        ],
        runAgent: async (input: {
          userMessage: string;
          inputFiles?: { filename: string; mime: string; bytes: Buffer }[];
          onSessionId?: (id: string | null) => void;
        }) => {
          seen = input.userMessage;
          workspaceFiles = input.inputFiles ?? [];
          input.onSessionId?.("pi-in-1");
          return "方案大纲已生成。";
        },
      } as never,
    );
    expect(outcome).toBe("completed");
    expect(seen).toContain("[输入文件:客户需求.txt]");
    expect(seen).toContain("制造业");
    expect(seen).toContain("[附件:brand.png");
    expect(workspaceFiles.map((f) => f.filename)).toEqual(["客户需求.txt", "brand.png"]);
    const events = readTaskEvents(db, "r2rt-6");
    expect(events.map((e) => e.eventType)).toContain("inputs.delivered");
    finishLeasedTask(db, "r2rt-6", "runner-in", "completed");
  });
});

describe("R4 task 4.3 — estimated cost + REAL tool-call counting", () => {
  it("prices configured → cost computed; gateway tool calls counted", async () => {
    // Price-bearing endpoint (single row) + ACL-granted shared doc; the
    // module payload already declares resources.search in toolRefs.
    rawExec(
      db,
      "UPDATE resources SET config = ? WHERE id = 'r2rt-ep'",
      JSON.stringify({
        baseUrl: "https://mock.local/v1",
        model: "mock-chat",
        apiKeyEnv: "R2RT_MOCK_KEY",
        priceInputCentsPerM: 100,
        priceOutputCentsPerM: 300,
      }),
    );
    const { addSharedDocResource } = await import("@forgegent/registry");
    addSharedDocResource(db, {
      name: "公开手册",
      entries: [{ id: "e1", title: "品牌规范", content: "forgegent 蓝" }],
      grants: [{ subjectType: "all_users" }],
    });
    seedReleaseAndTask("r2rt-7", "sess-cost");
    rawExec(
      db,
      "INSERT OR REPLACE INTO tool_policies (id, release_id, tool_id, resource_scope, allowed_actions) VALUES ('r2rt-tp-s', 'r2rt-rel', 'resources.search', NULL, 'invoke')",
    );
    const claimed = claimNextTask(db, "runner-cost", 60)!;
    expect(claimed.id).toBe("r2rt-7");
    const outcome = await executeRestrictedTask(
      db,
      store,
      claimed,
      {
        async runAgent(input: {
          tools: { name: string; execute: (a: Record<string, unknown>) => Promise<string> }[];
          onSessionId?: (id: string | null) => void;
        }) {
          input.onSessionId?.("pi-cost");
          const search = input.tools.find((t) => t.name === "resources.search");
          if (search) await search.execute({ query: "forgegent" });
          return "done";
        },
        loadSkills: () => ({ skills: [], diagnostics: [] }),
        collectArtifacts: () => [],
        trackArtifactSource: () => undefined,
        saveArtifact: async () => ({ id: "f" }),
      } as never,
    );
    expect(outcome).toBe("completed");
    const completed = readTaskEvents(db, "r2rt-7").find((e) => e.eventType === "run.completed");
    expect(completed).toBeDefined();
    const p = completed!.safePayload as {
      toolCalls: number;
      estimatedCostCents: number;
      pricing: { configured: boolean };
    };
    expect(p.toolCalls).toBe(1); // the ONE gateway-wrapped search execution
    expect(p.estimatedCostCents).toBeGreaterThan(0);
    expect(p.pricing.configured).toBe(true);
    finishLeasedTask(db, "r2rt-7", "runner-cost", "completed");
  });

  it("no prices → cost 0 with the explicit not-configured note", async () => {
    // Reset the endpoint config (seed uses INSERT OR IGNORE — the priced
    // row from the previous case would persist otherwise).
    rawExec(
      db,
      "UPDATE resources SET config = ? WHERE id = 'r2rt-ep'",
      JSON.stringify({ baseUrl: "https://mock.local/v1", model: "mock-chat", apiKeyEnv: "R2RT_MOCK_KEY" }),
    );
    seedReleaseAndTask("r2rt-8", "sess-cost2");
    const claimed = claimNextTask(db, "runner-cost2", 60)!;
    const outcome = await executeRestrictedTask(
      db,
      store,
      claimed,
      fakeDeps({}),
    );
    expect(outcome).toBe("completed");
    const completed = readTaskEvents(db, "r2rt-8").find((e) => e.eventType === "run.completed");
    const p = completed!.safePayload as {
      estimatedCostCents: number;
      pricing: { configured: boolean; note?: string };
    };
    expect(p.estimatedCostCents).toBe(0);
    expect(p.pricing.configured).toBe(false);
    expect(p.pricing.note).toContain("未配置单价");
    finishLeasedTask(db, "r2rt-8", "runner-cost2", "completed");
  });
});

describe("R2 1.2/2.13 — timeout aborts the in-flight run (best effort)", () => {
  it("the abort signal fires inside the run when the deadline hits", async () => {
    seedReleaseAndTask("r2rt-5", "sess-timeout");
    // Claim until we hold exactly our task (earlier pending rows may linger).
    let claimed: ClaimedTask | null = null;
    for (let i = 0; i < 10 && !claimed; i += 1) {
      const next = claimNextTask(db, "runner-t", 60);
      if (!next) break;
      if (next.id === "r2rt-5") claimed = next;
    }
    expect(claimed).not.toBeNull();
    let aborted = false;
    const outcome = await runGuarded(db, claimed, {
      timeoutMs: 60,
      run: (signal) =>
        new Promise<"failed">((resolve) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            resolve("failed");
          });
        }),
    });
    expect(outcome).toBe("failed");
    expect(aborted).toBe(true);
    const events = readTaskEvents(db, "r2rt-5");
    expect(events.some((e) => e.eventType === "run.failed")).toBe(true);
  });
});

void ({} as ClaimedTask | undefined);
