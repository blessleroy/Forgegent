/**
 * Restricted task executor (task 4.7 backend side; design D2/D5).
 *
 * F1 rewiring: the production path now runs the REAL pi agent loop through
 * runProductionAgent against the admin-configured endpoint. Platform tools
 * are wrapped by the Tool Gateway (every call checked: user ∩ release ∩
 * task + file ACL + egress), generated artifacts are written back from the
 * poster tool's real payloads, and session_refs is persisted for
 * crash-recovery resume (FR-06.6).
 */
import { join } from "node:path";
import {
  appendTaskEvent,
  rawExec,
  rawQuery,
  type ForgegentDb,
} from "@forgegent/db";
import type { ClaimedTask } from "@forgegent/db";
import { FileStore } from "@forgegent/storage";
import { ReleaseStore } from "@forgegent/registry";
import { withGateway } from "@forgegent/gateway";
import { egressAllowlistForRelease } from "@forgegent/registry";
import {
  createPosterTool,
  runProductionAgent,
  type ProductionToolSpec,
} from "@forgegent/pi-adapter";

export interface ModelEndpointConfig {
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
}

/** Resolve the model endpoint resource (key via env, never stored). */
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
  /**
   * Runs the agent loop. Production default wires runProductionAgent with
   * gateway-wrapped tools; tests inject a fake.
   */
  runAgent(input: {
    systemPrompt?: string;
    userMessage: string;
    tools: ProductionToolSpec[];
    toolAllowlist: string[];
    onEvent?: (e: { type: string; text?: string }) => void;
  }): Promise<string>;
  saveArtifact(
    ownerId: string,
    taskId: string,
    filename: string,
    mime: string,
    bytes: Buffer,
  ): Promise<{ id: string }>;
  /** Track artifact sources for write-back (poster tool payloads). */
  trackArtifactSource?(name: string, ref: unknown): void;
  /** Collect artifact payloads produced during the run. */
  collectArtifacts?(): { mime: string; bytes: Buffer }[];
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
    appendTaskEvent(db, task.id, "run.failed", {
      errorType: "release-missing", requestId,
      reason: "release snapshot missing",
    });
    return "failed";
  }
  let snapshot;
  try {
    snapshot = store.loadSnapshot(releaseRow.immutable_package_path, releaseRow.checksum);
  } catch (error) {
    appendTaskEvent(db, task.id, "run.failed", {
      errorType: "snapshot-integrity", requestId,
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
      errorType: "model-endpoint-missing", requestId,
      reason: "模型端点未配置 — 请管理员在资源配置中添加 OpenAI 兼容端点 / model endpoint not configured",
    });
    return "failed";
  }

  // ---- F1: gateway-wrapped platform tools (FR-09.3 production wiring) ----
  const egress = egressAllowlistForRelease(db, task.agentReleaseId);
  const declaredTools = rawQuery<{ tool_id: string }>(
    db,
    "SELECT tool_id FROM tool_policies WHERE release_id = ?",
    task.agentReleaseId,
  ).map((r) => r.tool_id);
  const gatewayCtx = {
    userId: task.ownerId,
    roles: ["employee"],
    taskId: task.id,
  };
  const releaseToolRefs: string[] = Array.isArray(snapshot.payload.toolRefs)
    ? snapshot.payload.toolRefs
    : [];
  const posterTool =
    releaseToolRefs.includes("image.generate") &&
    declaredTools.includes("image.generate")
      ? createPosterTool({
          baseUrl: endpoint.baseUrl,
          apiKey: process.env[endpoint.apiKeyEnv] ?? "",
          model: endpoint.model,
        })
      : null;
  const tools: ProductionToolSpec[] = [];
  if (posterTool) {
    deps.trackArtifactSource?.("image.generate", posterTool);
    tools.push({
      name: "image.generate",
      description: posterTool.description,
      execute: (args) => posterTool.execute(args),
    });
  }
  const gatewayTools = tools.map((tool) => ({
    ...tool,
    execute: withGateway(
      db,
      { ...gatewayCtx, toolId: tool.name },
      tool.execute,
      { egressAllowlist: egress },
    ),
  }));
  const toolAllowlist = gatewayTools.map((t) => t.name);

  try {
    const output = await deps.runAgent({
      systemPrompt: snapshot.payload.prompts?.system,
      userMessage: task.inputSummary ?? "",
      tools: gatewayTools,
      toolAllowlist,
      onEvent: (e) => {
        if (e.type === "text_delta" && e.text) {
          // Streaming deltas are aggregated; the final text lands in
          // agent.output below (bounded).
        }
      },
    });
    const inputTokens = Math.ceil((task.inputSummary ?? "").length / 4);
    const outputTokens = Math.ceil(output.length / 4);
    const budget = typeof task.budget === "string"
      ? (JSON.parse(task.budget) as { maxTokens?: number })
      : null;
    if (budget?.maxTokens && inputTokens + outputTokens > budget.maxTokens) {
      appendTaskEvent(db, task.id, "run.failed", {
        errorType: "token-budget-exceeded", requestId,
        durationMs: Date.now() - startedAt,
        reason: `Token 预算超限（${inputTokens + outputTokens} > ${budget.maxTokens}）— 安全终止`,
      });
      rawExec(
        db,
        "INSERT INTO usage_records (id, task_id, model, input_tokens, output_tokens, estimated_cost) VALUES (?, ?, ?, ?, ?, 0)",
        crypto.randomUUID(), task.id, endpoint.model, inputTokens, outputTokens,
      );
      return "failed";
    }
    appendTaskEvent(db, task.id, "agent.output", { text: output.slice(0, 2000) });

    // ---- F1: real artifacts from tool payloads (no placeholders) ----
    const collected = deps.collectArtifacts?.() ?? [];
    for (const [i, artifact] of collected.entries()) {
      const ext = artifact.mime.includes("png") ? "png" : artifact.mime.includes("jpeg") ? "jpg" : "bin";
      const saved = await deps.saveArtifact(
        task.ownerId,
        task.id,
        `artifact-${snapshot.version}-${i + 1}.${ext}`,
        artifact.mime,
        artifact.bytes,
      );
      rawExec(
        db,
        "INSERT OR REPLACE INTO task_file_refs (task_id, file_id, direction) VALUES (?, ?, 'output')",
        task.id,
        saved.id,
      );
      appendTaskEvent(db, task.id, "artifact.saved", {
        fileId: saved.id,
        mime: artifact.mime,
        bytes: artifact.bytes.byteLength,
      });
    }

    appendTaskEvent(db, task.id, "run.completed", {
      requestId,
      durationMs: Date.now() - startedAt,
      toolCalls: collected.length,
      model: endpoint.model,
      inputTokens,
      outputTokens,
    });
    rawExec(
      db,
      "INSERT INTO usage_records (id, task_id, model, input_tokens, output_tokens, estimated_cost) VALUES (?, ?, ?, ?, ?, 0)",
      crypto.randomUUID(), task.id, endpoint.model, inputTokens, outputTokens,
    );
    // FR-06.6: persist the session reference for crash-resume.
    if (task.sessionId) {
      const existing = rawQuery<{ id: string }>(
        db,
        "SELECT id FROM session_refs WHERE task_id = ?",
        task.id,
      )[0];
      if (existing) {
        rawExec(
          db,
          "UPDATE session_refs SET updated_at = ? WHERE task_id = ?",
          Date.now(),
          task.id,
        );
      } else {
        rawExec(
          db,
          "INSERT INTO session_refs (id, task_id, session_path, updated_at) VALUES (?, ?, ?, ?)",
          crypto.randomUUID(),
          task.id,
          `sessions/${task.sessionId}`,
          Date.now(),
        );
      }
    }
    return "completed";
  } catch (error) {
    appendTaskEvent(db, task.id, "run.failed", {
      errorType: "agent-error", requestId,
      durationMs: Date.now() - startedAt,
      reason: String((error as Error).message).slice(0, 500),
    });
    return "failed";
  }
}

/** Production deps: real pi loop + FileStore artifacts (F1). */
export function createProductionDeps(
  db: ForgegentDb,
  workspaceRoot: string,
): ExecutorDeps {
  const artifactRefs = new Map<string, { drainArtifacts(): { b64: string; mimeType: string }[] }>();
  return {
    async runAgent({ systemPrompt, userMessage, tools, toolAllowlist, onEvent }) {
      const endpoint = resolveModelEndpoint(db);
      if (!endpoint) throw new Error("model endpoint missing");
      const result = await runProductionAgent({
        cwd: join(workspaceRoot, "work"),
        userPrompt: userMessage,
        endpoint,
        systemPrompt,
        tools,
        toolAllowlist,
        onEvent,
      });
      return result.text;
    },
    async saveArtifact(ownerId, taskId, filename, mime, bytes) {
      const store = new FileStore(join(workspaceRoot, "files"), db);
      const saved = await store.put({ ownerId, filename, mime, bytes, taskId });
      return saved;
    },
    trackArtifactSource(name, ref) {
      artifactRefs.set(name, ref as never);
    },
    collectArtifacts() {
      const out: { mime: string; bytes: Buffer }[] = [];
      for (const ref of artifactRefs.values()) {
        for (const artifact of ref.drainArtifacts()) {
          out.push({ mime: artifact.mimeType, bytes: Buffer.from(artifact.b64, "base64") });
        }
      }
      return out;
    },
  };
}
