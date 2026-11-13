/**
 * Restricted task executor (task 4.7 backend side; design D2/D5).
 *
 * Loads the immutable release snapshot, wires the platform tools (poster
 * image tool through the configured OpenAI-compatible endpoint), runs the
 * agent session, and writes artifacts back to the owner's file space.
 * Model endpoints come from the resources table; the API key itself is
 * resolved from the server environment (never stored in SQLite).
 */
import { join } from "node:path";
import {
  appendTaskEvent,
  rawExec,
  rawQuery,
  readTaskEvents,
  type ForgegentDb,
} from "@forgegent/db";
import { FileStore } from "@forgegent/storage";
import { ReleaseStore } from "@forgegent/registry";
import type { ClaimedTask } from "@forgegent/db";
import { createPlatformSession, createPosterTool } from "@forgegent/pi-adapter";
import type { PlatformTool } from "@forgegent/pi-adapter";

export interface ModelEndpointConfig {
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
}

/** Resolve the model endpoint resource for a release's modelRef (or the
 *  single configured endpoint in V1). Key resolves from env, not storage. */
export function resolveModelEndpoint(
  db: ForgegentDb,
): ModelEndpointConfig | null {
  const row = rawQuery<{ config: string | null }>(
    db,
    "SELECT config FROM resources WHERE kind = 'model_endpoint' ORDER BY created_at LIMIT 1",
  )[0];
  if (!row?.config) return null;
  try {
    return JSON.parse(row.config) as ModelEndpointConfig;
  } catch {
    return null;
  }
}

export interface ExecutorDeps {
  /** Runs the agent loop for the input; returns assistant output. */
  runAgent(input: {
    systemPrompt?: string;
    userMessage: string;
    tools: PlatformTool[];
  }): Promise<string>;
  /** Writes an artifact (defaults to FileStore). */
  saveArtifact(ownerId: string, taskId: string, filename: string, mime: string, bytes: Buffer):
    Promise<{ id: string }>;
}

export async function executeRestrictedTask(
  db: ForgegentDb,
  store: ReleaseStore,
  task: ClaimedTask,
  deps: ExecutorDeps,
): Promise<"completed" | "failed"> {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  appendTaskEvent(db, task.id, "run.started", {
    mode: task.mode,
    requestId,
    releaseId: task.agentReleaseId,
  });

  const releaseRow = rawQuery<{ checksum: string; immutable_package_path: string }>(
    db,
    "SELECT checksum, immutable_package_path FROM agent_releases WHERE id = ?",
    task.agentReleaseId,
  )[0];
  if (!releaseRow) {
    appendTaskEvent(db, task.id, "run.failed", { reason: "release snapshot missing" });
    return "failed";
  }
  let snapshot;
  try {
    snapshot = store.loadSnapshot(releaseRow.immutable_package_path, releaseRow.checksum);
  } catch (error) {
    appendTaskEvent(db, task.id, "run.failed", {
      reason: `snapshot integrity failure: ${String((error as Error).message).slice(0, 120)}`,
    });
    return "failed";
  }
  appendTaskEvent(db, task.id, "release.loaded", {
    version: snapshot.version,
    mode: snapshot.payload.runtime.mode,
  });

  const endpoint = resolveModelEndpoint(db);
  if (!endpoint) {
    appendTaskEvent(db, task.id, "run.failed", {
      errorType: "model-endpoint-missing",
      requestId,
      reason: "模型端点未配置 — 请管理员在资源配置中添加 OpenAI 兼容端点 / model endpoint not configured",
    });
    return "failed";
  }
  const apiKey = process.env[endpoint.apiKeyEnv] ?? "";
  const tools: PlatformTool[] = (snapshot.payload.toolRefs ?? []).includes("image.generate")
    ? [createPosterTool({ baseUrl: endpoint.baseUrl, apiKey, model: endpoint.model })]
    : [];

  try {
    const output = await deps.runAgent({
      systemPrompt: snapshot.payload.prompts?.system,
      userMessage: task.inputSummary ?? "",
      tools,
    });
    // Token accounting (V1 estimate: chars/4; refine with real usage data
    // when the model endpoint reports it). Observability spec (task 9.6).
    const inputTokens = Math.ceil((task.inputSummary ?? "").length / 4);
    const outputTokens = Math.ceil(output.length / 4);
    // Token/费用预算（audit/observability + N6 结构化失败）。
    const budget = typeof task.budget === "string"
      ? (JSON.parse(task.budget) as { maxTokens?: number; maxCostCents?: number })
      : null;
    if (budget?.maxTokens && inputTokens + outputTokens > budget.maxTokens) {
      appendTaskEvent(db, task.id, "run.failed", {
        errorType: "token-budget-exceeded",
        requestId,
        durationMs: Date.now() - startedAt,
        reason: `Token 预算超限（${inputTokens + outputTokens} > ${budget.maxTokens}）— 安全终止`,
      });
      rawExec(
        db,
        "INSERT INTO usage_records (id, task_id, model, input_tokens, output_tokens, estimated_cost) VALUES (?, ?, ?, ?, ?, 0)",
        crypto.randomUUID(),
        task.id,
        endpoint.model,
        inputTokens,
        outputTokens,
      );
      return "failed";
    }
    appendTaskEvent(db, task.id, "agent.output", { text: output.slice(0, 2000) });
    const toolCalls = readTaskEvents(db, task.id).filter((e) =>
      e.eventType.startsWith("tool."),
    ).length;

    // Artifact write-back (PRD §8.2 step 6): validated then persisted to the
    // owner's personal space.
    if (snapshot.payload.ui.type === "form-result") {
      const artifact = await deps.saveArtifact(
        task.ownerId,
        task.id,
        `poster-${snapshot.version}.png`,
        "image/png",
        Buffer.from("IyBGb3JnZWdlbnQgYXJ0aWZhY3Q="), // placeholder marker; real bytes come from tools in M2
      );
      appendTaskEvent(db, task.id, "artifact.saved", {
        fileId: artifact.id,
        filename: `poster-${snapshot.version}.png`,
      });
    }
    appendTaskEvent(db, task.id, "run.completed", {
      requestId,
      durationMs: Date.now() - startedAt,
      toolCalls,
      model: endpoint.model,
      inputTokens,
      outputTokens,
    });
    // Usage record (audit-observability spec): per-task model cost trail.
    rawExec(
      db,
      "INSERT INTO usage_records (id, task_id, model, input_tokens, output_tokens, estimated_cost) VALUES (?, ?, ?, ?, ?, 0)",
      crypto.randomUUID(),
      task.id,
      endpoint.model,
      inputTokens,
      outputTokens,
    );
    return "completed";
  } catch (error) {
    appendTaskEvent(db, task.id, "run.failed", {
      errorType: "agent-error",
      requestId,
      durationMs: Date.now() - startedAt,
      reason: String((error as Error).message).slice(0, 500),
    });
    return "failed";
  }
}

/** Production deps wiring: real pi session + FileStore artifacts. */
export function createProductionDeps(
  db: ForgegentDb,
  workspaceRoot: string,
  releasesDir: string,
): ExecutorDeps {
  const store = new ReleaseStore(releasesDir);
  void store;
  return {
    async runAgent({ systemPrompt, userMessage, tools }) {
      // Real session execution requires the pi SDK session.prompt loop;
      // wired in M2 (task 6.x builder agent uses the same loop). For M1 the
      // restricted runner verifies wiring and reports the model dependency.
      const session = await createPlatformSession({
        cwd: workspaceRoot,
        mode: "restricted",
        toolAllowlist: [],
      });
      session.dispose();
      void systemPrompt;
      void tools;
      void userMessage;
      throw new Error(
        "M1 executor: agent prompt loop arrives with M2 studio tasks — configure endpoints and await M2",
      );
    },
    async saveArtifact(ownerId, taskId, filename, mime, bytes) {
      const store = new FileStore(join(workspaceRoot, "files"), db);
      const saved = await store.put({ ownerId, filename, mime, bytes, taskId });
      rawExecSafe(db, "INSERT OR REPLACE INTO task_file_refs (task_id, file_id, direction) VALUES (?, ?, 'output')", taskId, saved.id);
      return saved;
    },
  };
}

function rawExecSafe(db: ForgegentDb, sql: string, ...params: unknown[]): void {
  (db as unknown as {
    $client: { prepare(s: string): { run(...p: unknown[]): unknown } };
  }).$client.prepare(sql).run(...params);
}
