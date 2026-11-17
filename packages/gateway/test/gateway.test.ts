import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, rawExec, rawQuery, users } from "@forgegent/db";
import type { ForgegentDb } from "@forgegent/db";
import {
  createDraft,
  reviewDraft,
  setAgentGrants,
  submitDraft,
  ReleaseStore,
} from "@forgegent/registry";
import { createTask, transitionTask } from "@forgegent/tasks";
import { checkToolCall, withGateway } from "../src/index.js";

const db: ForgegentDb = createTestDb();
const store = new ReleaseStore(mkdtempSync(join(tmpdir(), "gw-rel-")));
let releasesDir: string;

const alice = "gw-alice";
const bob = "gw-bob";
const admin = "gw-admin";
const builder = "gw-builder";

beforeAll(async () => {
  releasesDir = store["releasesDir" as keyof ReleaseStore] as string;
  store.init();
  for (const [id, email] of [
    [alice, "alice@gw.local"],
    [bob, "bob@gw.local"],
    [admin, "admin@gw.local"],
    [builder, "builder@gw.local"],
  ] as const) {
    await db.insert(users).values({ id, email }).onConflictDoNothing();
  }
  // D37: `http.*` tool references require a prior admin declaration.
  rawExec(
    db,
    "INSERT INTO resources (id, kind, name, config) VALUES ('gw-http-fetch', 'http_tool', 'fetch', ?)",
    JSON.stringify({
      name: "fetch",
      endpoint: "https://api.gw.local/data",
      method: "GET",
      paramSchema: { type: "object", properties: {} },
      authType: "none",
    }),
  );
});

afterAll(() => {
  for (const entry of releasesDir ? [] : []) void entry;
  try {
    rmSync(releasesDir, { recursive: true, force: true });
  } catch {
    /* read-only dirs; OS temp cleanup handles it */
  }
});

async function publishAgentWithTools(slug: string, toolRefs: string[]) {
  const draft = await createDraft(db, {
    builderId: builder,
    slug,
    payload: {
      schemaVersion: "1.0",
      name: slug,
      description: "x",
      version: "1.0.0",
      ui: { type: "form-result", schema: { fields: [] } },
      runtime: { engine: "pi-coding-agent", mode: "restricted" },
      toolRefs,
    },
  });
  await submitDraft(db, { draftId: draft.draftId, builderId: builder });
  const result = await reviewDraft(db, store, {
    draftId: draft.draftId,
    adminId: admin,
    decision: "approve",
  });
  if (!("releaseId" in result)) throw new Error("publish failed");
  await setAgentGrants(db, {
    agentId: draft.agentId,
    grants: [{ subjectType: "all_users" }],
  });
  return { agentId: draft.agentId, releaseId: result.releaseId };
}

async function runningTask(agentId: string, ownerId = alice) {
  const task = await createTask(db, {
    ownerId,
    roles: ["employee"],
    agentId,
    inputSummary: "test",
  });
  await transitionTask(db, task.id, "pending", "starting");
  await transitionTask(db, task.id, "starting", "running");
  return task;
}

describe("permission intersection (task 5.1 — FR-09)", () => {
  it("AT-05: shell/undeclared tools are denied at the execution layer", async () => {
    const agent = await publishAgentWithTools("at05-agent", ["image.generate"]);
    const task = await runningTask(agent.agentId);
    const bash = await checkToolCall(db, {
      userId: alice,
      roles: ["employee"],
      taskId: task.id,
      toolId: "bash",
      params: { command: "cat /etc/passwd" },
    });
    expect(bash.allowed).toBe(false);
    expect(bash.reason).toContain("not declared");
    // Declared tools pass the declaration gate.
    const ok = await checkToolCall(db, {
      userId: alice,
      roles: ["employee"],
      taskId: task.id,
      toolId: "image.generate",
      params: { prompt: "x", key: "k" },
    });
    expect(ok.allowed).toBe(true);
  });

  it("denials are audited without secrets (FR-09.7)", async () => {
    const agent = await publishAgentWithTools("audit-agent", ["image.generate"]);
    const task = await runningTask(agent.agentId);
    await checkToolCall(db, {
      userId: alice,
      roles: ["employee"],
      taskId: task.id,
      toolId: "bash",
      params: { command: "secret", apiKey: "sk-hidden-value" },
    });
    const rows = rawQuery<{ action: string; decision: string; reason: string }>(
      db,
      "SELECT action, decision, reason FROM audit_logs WHERE action = 'tool.invoke:bash' ORDER BY created_at DESC, rowid DESC",
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]!.decision).toBe("deny");
    expect(rows[0]!.reason).toContain("not declared");
    expect(rows[0]!.reason).not.toContain("sk-hidden-value");
  });

  it("task ownership intersects: another user's task is rejected", async () => {
    const agent = await publishAgentWithTools("owner-agent", ["image.generate"]);
    const task = await runningTask(agent.agentId, alice);
    const decision = await checkToolCall(db, {
      userId: bob,
      roles: ["employee"],
      taskId: task.id,
      toolId: "image.generate",
      params: {},
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("does not belong");
  });

  it("terminal tasks cannot invoke tools", async () => {
    const agent = await publishAgentWithTools("state-agent", ["image.generate"]);
    const task = await runningTask(agent.agentId);
    await transitionTask(db, task.id, "running", "completed");
    const decision = await checkToolCall(db, {
      userId: alice,
      roles: ["employee"],
      taskId: task.id,
      toolId: "image.generate",
      params: {},
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("state completed");
  });

  it("AT-18: forged file parameters are blocked before execution", async () => {
    const agent = await publishAgentWithTools("at18-agent", ["file.read"]);
    // Bob owns a file; Alice's task tries to read it via forged params.
    rawExec(
      db,
      "INSERT OR REPLACE INTO files (id, owner_id, storage_key, filename, size, mime, checksum) VALUES ('bob-file', ?, 'k', 'secret.txt', 10, 'text/plain', 'c')",
      bob,
    );
    const task = await runningTask(agent.agentId, alice);
    const forged = await checkToolCall(db, {
      userId: alice,
      roles: ["employee"],
      taskId: task.id,
      toolId: "file.read",
      params: { fileId: "bob-file" },
    });
    expect(forged.allowed).toBe(false);
    expect(forged.reason).toContain("not accessible");
    // The owner passes for their own file.
    rawExec(
      db,
      "INSERT OR REPLACE INTO files (id, owner_id, storage_key, filename, size, mime, checksum) VALUES ('alice-file', ?, 'k', 'a.txt', 5, 'text/plain', 'c')",
      alice,
    );
    const own = await checkToolCall(db, {
      userId: alice,
      roles: ["employee"],
      taskId: task.id,
      toolId: "file.read",
      params: { fileId: "alice-file" },
    });
    expect(own.allowed).toBe(true);
  });

  it("egress allowlist blocks non-declared hosts", async () => {
    const agent = await publishAgentWithTools("egress-agent", ["http.fetch"]);
    const task = await runningTask(agent.agentId);
    const blocked = await checkToolCall(
      db,
      {
        userId: alice,
        roles: ["employee"],
        taskId: task.id,
        toolId: "http.fetch",
        params: { url: "https://evil.example.com/exfil" },
      },
      { egressAllowlist: ["api.partner.local"] },
    );
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain("egress");
    const allowed = await checkToolCall(
      db,
      {
        userId: alice,
        roles: ["employee"],
        taskId: task.id,
        toolId: "http.fetch",
        params: { url: "https://api.partner.local/v1/data" },
      },
      { egressAllowlist: ["api.partner.local"] },
    );
    expect(allowed.allowed).toBe(true);
  });

  it("withGateway wraps executors: denied calls never reach side effects", async () => {
    const agent = await publishAgentWithTools("wrap-agent", ["image.generate"]);
    const task = await runningTask(agent.agentId);
    let executed = 0;
    const wrapped = withGateway(
      db,
      { userId: alice, roles: ["employee"], taskId: task.id, toolId: "bash" },
      async () => {
        executed += 1;
        return "should not run";
      },
    );
    const out = await wrapped({ command: "rm -rf /" });
    expect(out).toMatch(/^gateway-deny:/);
    expect(executed).toBe(0);
  });
});
