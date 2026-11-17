/**
 * R3 3.3 regressions — the runner's sandboxed execution channel:
 * - sandboxed task + available channel → sandbox.attached, sandbox.exec tool
 *   present and functional (commands run through the channel);
 * - sandboxed task + UNAVAILABLE channel → structured failure
 *   (sandbox-unavailable), never a silent restricted downgrade;
 * - restricted task → no sandbox.exec tool at all.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  createTestDb,
  claimNextTask,
  finishLeasedTask,
  rawExec,
  readTaskEvents,
  type ForgegentDb,
} from "@forgegent/db";
import { ReleaseStore, type DraftPayload } from "@forgegent/registry";
import { executeRestrictedTask } from "../src/executor.js";

const db: ForgegentDb = createTestDb();
const releasesDir = mkdtempSync(join(tmpdir(), "r3sb-rel-"));
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
  name: "脚本 Agent",
  description: "scripted",
  version: "1.0.0",
  ui: { type: "form-result", schema: { fields: [] } },
  runtime: { engine: "pi-coding-agent", mode: "sandboxed" },
  toolRefs: ["sandbox.exec"],
};

function seedTask(
  taskId: string,
  mode: "sandboxed" | "restricted",
  sessionId = "sess-r3",
): void {
  rawExec(db, "INSERT OR IGNORE INTO users (id, email) VALUES ('r3-emp', 'emp@r3.local')");
  rawExec(db, "INSERT OR IGNORE INTO agents (id, slug, name, owner_id) VALUES ('r3-agent', 'r3-script-agent', 'S', 'r3-emp')");
  const existing = (
    db as unknown as { $client: { prepare(s: string): { get(...p: unknown[]): unknown } } }
  ).$client.prepare("SELECT id FROM agent_releases WHERE id = 'r3-rel'").get();
  if (!existing) {
    const snap = store.writeSnapshot({
      releaseId: "r3-rel",
      agentId: "r3-agent",
      version: "1.0.0",
      payload,
      publishedBy: "r3-emp",
    });
    rawExec(
      db,
      "INSERT INTO agent_releases (id, agent_id, version, immutable_package_path, checksum, published_by) VALUES ('r3-rel', 'r3-agent', '1.0.0', ?, ?, 'r3-emp')",
      snap.releaseId,
      snap.checksum,
    );
    rawExec(
      db,
      "INSERT INTO tool_policies (id, release_id, tool_id, resource_scope, allowed_actions) VALUES ('r3-tp1', 'r3-rel', 'sandbox.exec', NULL, 'invoke')",
    );
  }
  rawExec(
    db,
    "INSERT OR REPLACE INTO resources (id, kind, name, config) VALUES ('r3-ep', 'model_endpoint', 'default', ?)",
    JSON.stringify({ baseUrl: "https://mock.local/v1", model: "m", apiKeyEnv: "R3_MOCK_KEY" }),
  );
  process.env.R3_MOCK_KEY = "k";
  rawExec(
    db,
    `INSERT OR REPLACE INTO tasks (id, owner_id, agent_release_id, state, mode, session_id)
     VALUES (?, 'r3-emp', 'r3-rel', 'pending', ?, 'sess-r3')`,
    taskId,
    mode,
  );
}

function fakeDeps(sandbox?: {
  available: boolean;
  execLog?: string[];
}) {
  return {
    async runAgent(input: {
      tools: { name: string; execute?: (args: Record<string, unknown>) => Promise<string> }[];
      onSessionId?: (id: string | null) => void;
    }) {
      input.onSessionId?.("pi-r3");
      void input;
      return "脚本已执行（mock）。";
    },
    loadSkills: () => ({ skills: [], diagnostics: [] }),
    collectArtifacts: () => [],
    trackArtifactSource: () => undefined,
    saveArtifact: async () => ({ id: "f" }),
    sandbox: sandbox && {
      available: sandbox.available,
      acquireForTask: async () => ({
        exec: async (command: string) => {
          sandbox.execLog?.push(command);
          return { exitCode: 0, stdout: `ran: ${command}`, stderr: "" };
        },
        teardown: async () => undefined,
      }),
      teardownTask: async () => undefined,
    },
  } as never;
}

describe("R3 task 3.3 — sandboxed execution channel", () => {
  it("attaches the channel and exposes a working sandbox.exec tool", async () => {
    seedTask("r3-1", "sandboxed");
    const claimed = claimNextTask(db, "r3-run", 60)!;
    const execLog: string[] = [];
    let capturedTools: { name: string; execute?: (a: Record<string, unknown>) => Promise<string> }[] = [];
    const deps = {
      async runAgent(input: {
        tools: { name: string; execute?: (args: Record<string, unknown>) => Promise<string> }[];
        onSessionId?: (id: string | null) => void;
      }) {
        capturedTools = input.tools;
        input.onSessionId?.("pi-r3");
        return "脚本已执行。";
      },
      loadSkills: () => ({ skills: [], diagnostics: [] }),
      collectArtifacts: () => [],
      trackArtifactSource: () => undefined,
      saveArtifact: async () => ({ id: "f" }),
      sandbox: {
        available: true,
        acquireForTask: async () => ({
          exec: async (command: string) => {
            execLog.push(command);
            return { exitCode: 0, stdout: `ran: ${command}`, stderr: "" };
          },
          teardown: async () => undefined,
        }),
        teardownTask: async () => undefined,
      },
    } as never;
    const outcome = await executeRestrictedTask(db, store, claimed, deps);
    expect(outcome).toBe("completed");
    expect(readTaskEvents(db, "r3-1").map((e) => e.eventType)).toContain("sandbox.attached");
    const tool = capturedTools.find((t) => t.name === "sandbox.exec");
    expect(tool).toBeDefined();
    const result = await tool!.execute!({ command: "python scripts/run.py" });
    expect(execLog).toEqual(["python scripts/run.py"]);
    expect(result).toContain("ran: python scripts/run.py");
    finishLeasedTask(db, "r3-1", "r3-run", "completed");
  });

  it("unavailable channel fails sandboxed tasks structurally (no downgrade)", async () => {
    seedTask("r3-2", "sandboxed");
    const claimed = claimNextTask(db, "r3-run2", 60)!;
    const outcome = await executeRestrictedTask(
      db,
      store,
      claimed,
      fakeDeps({ available: false }),
    );
    expect(outcome).toBe("failed");
    const failure = readTaskEvents(db, "r3-2").find((e) => e.eventType === "run.failed");
    expect(failure).toBeDefined();
    expect((failure!.safePayload as { errorType: string }).errorType).toBe("sandbox-unavailable");
    finishLeasedTask(db, "r3-2", "r3-run2", "failed");
  });

  it("restricted tasks never see the sandbox.exec tool", async () => {
    seedTask("r3-3", "restricted", "sess-r3c");
    const claimed = claimNextTask(db, "r3-run3", 60)!;
    let toolNames: string[] = [];
    const deps = {
      async runAgent(input: { tools: { name: string }[]; onSessionId?: (id: string | null) => void }) {
        toolNames = input.tools.map((t) => t.name);
        input.onSessionId?.("pi-r3");
        return "完成。";
      },
      loadSkills: () => ({ skills: [], diagnostics: [] }),
      collectArtifacts: () => [],
      trackArtifactSource: () => undefined,
      saveArtifact: async () => ({ id: "f" }),
      sandbox: {
        available: true,
        acquireForTask: async () => {
          throw new Error("must not be called for restricted tasks");
        },
        teardownTask: async () => undefined,
      },
    } as never;
    const outcome = await executeRestrictedTask(db, store, claimed, deps);
    expect(outcome).toBe("completed");
    expect(toolNames).not.toContain("sandbox.exec");
    expect(toolNames).toContain("request_input");
  });
});
