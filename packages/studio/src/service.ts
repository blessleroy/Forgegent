/**
 * Studio service (studio-building spec; tasks 6.1–6.4).
 *
 * Conversation-driven draft lifecycle with persisted messages (N4):
 * converse() creates or refines a draft through the builder agent backend;
 * every round appends {role, text} records + structured metadata. Draft
 * ownership is enforced (D19) and the review gate (N5) runs at submit time.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { ForgegentDb } from "@forgegent/db";
import { rawExec, rawQuery, studioConversations } from "@forgegent/db";
import {
  createDraft,
  submitDraft as registrySubmit,
  updateDraft,
  validateDraftPayload,
  type DraftPayload,
} from "@forgegent/registry";
import type { BuilderAgentBackend } from "./backends.js";

export interface ConversationMessage {
  role: "builder" | "agent";
  text: string;
  clarifications?: string[];
  changes?: string[];
  draftId?: string;
  at: string;
}

export interface ConverseResult {
  draftId: string;
  agentId: string;
  slug: string;
  message: ConversationMessage;
  state: string;
}

export interface StartOptions {
  builderId: string;
  slug: string;
  brief: string;
}

async function loadConversation(
  db: ForgegentDb,
  draftId: string,
): Promise<{ id: string; builderId: string; messages: ConversationMessage[] }> {
  const row = rawQuery<{ id: string; builder_id: string; messages: string }>(
    db,
    "SELECT id, builder_id, messages FROM studio_conversations WHERE draft_id = ? ORDER BY created_at DESC LIMIT 1",
    draftId,
  )[0];
  return row
    ? {
        id: row.id,
        builderId: row.builder_id,
        messages: JSON.parse(row.messages) as ConversationMessage[],
      }
    : { id: "", builderId: "", messages: [] };
}

async function appendMessage(
  db: ForgegentDb,
  draftId: string,
  builderId: string,
  message: ConversationMessage,
): Promise<void> {
  const existing = rawQuery<{ id: string; messages: string }>(
    db,
    "SELECT id, messages FROM studio_conversations WHERE draft_id = ? ORDER BY created_at DESC LIMIT 1",
    draftId,
  )[0];
  if (existing) {
    const messages = [
      ...(JSON.parse(existing.messages) as ConversationMessage[]),
      message,
    ];
    rawExec(
      db,
      "UPDATE studio_conversations SET messages = ? WHERE id = ?",
      JSON.stringify(messages),
      existing.id,
    );
  } else {
    rawExec(
      db,
      "INSERT INTO studio_conversations (id, draft_id, builder_id, messages) VALUES (?, ?, ?, ?)",
      randomUUID(),
      draftId,
      builderId,
      JSON.stringify([message]),
    );
  }
}

/** New draft from a natural-language brief (task 6.1, AT-01). */
export async function startConversation(
  db: ForgegentDb,
  backend: BuilderAgentBackend,
  options: StartOptions,
): Promise<ConverseResult> {
  const plan = await backend.generateDraft(options.brief);
  const draft = await createDraft(db, {
    builderId: options.builderId,
    slug: options.slug,
    payload: plan.payload,
  });
  await appendMessage(db, draft.draftId, options.builderId, {
    role: "builder",
    text: options.brief,
    at: new Date().toISOString(),
  });
  const message: ConversationMessage = {
    role: "agent",
    text: `${plan.plan}\n需求清单：\n${plan.requirements.map((r) => `- ${r}`).join("\n")}`,
    clarifications: plan.clarifications,
    draftId: draft.draftId,
    at: new Date().toISOString(),
  };
  await appendMessage(db, draft.draftId, options.builderId, message);
  return {
    draftId: draft.draftId,
    agentId: draft.agentId,
    slug: draft.slug,
    message,
    state: draft.state,
  };
}

/** Refine the current draft through conversation (task 6.2, AT-02). */
export async function continueConversation(
  db: ForgegentDb,
  backend: BuilderAgentBackend,
  params: { draftId: string; builderId: string; instruction: string },
): Promise<ConverseResult> {
  const owner = rawQuery<{ builder_id: string }>(
    db,
    "SELECT builder_id FROM agent_drafts WHERE id = ?",
    params.draftId,
  )[0];
  if (!owner) throw new Error("draft not found");
  if (owner.builder_id !== params.builderId) {
    throw new Error("only the draft owner may continue (D19)");
  }
  const currentRow = rawQuery<{ draft_payload: string }>(
    db,
    "SELECT draft_payload FROM agent_drafts WHERE id = ?",
    params.draftId,
  )[0];
  if (!currentRow) throw new Error("draft payload missing");
  const current = JSON.parse(currentRow.draft_payload) as DraftPayload;
  const modification = await backend.modifyDraft(current, params.instruction);
  const updated = await updateDraft(db, {
    draftId: params.draftId,
    builderId: params.builderId,
    payload: modification.payload,
  });
  await appendMessage(db, params.draftId, params.builderId, {
    role: "builder",
    text: params.instruction,
    at: new Date().toISOString(),
  });
  const message: ConversationMessage = {
    role: "agent",
    text: `已修改草稿，变更：\n${modification.changes.map((c) => `- ${c}`).join("\n")}`,
    changes: modification.changes,
    draftId: params.draftId,
    at: new Date().toISOString(),
  };
  await appendMessage(db, params.draftId, params.builderId, message);
  return {
    draftId: updated.draftId,
    agentId: updated.agentId,
    slug: updated.slug,
    message,
    state: updated.state,
  };
}

/** Read the conversation (owner or admin). */
export function readConversation(
  db: ForgegentDb,
  draftId: string,
): ConversationMessage[] {
  return loadConversationSync(db, draftId);
}

function loadConversationSync(db: ForgegentDb, draftId: string): ConversationMessage[] {
  const row = rawQuery<{ messages: string }>(
    db,
    "SELECT messages FROM studio_conversations WHERE draft_id = ? ORDER BY created_at DESC LIMIT 1",
    draftId,
  )[0];
  return row ? (JSON.parse(row.messages) as ConversationMessage[]) : [];
}

/* --------------------------- review gate (N5) --------------------------- */

export interface GateResult {
  passed: boolean;
  failures: string[];
  summary: string;
}

/**
 * Submit-time automatic test gate (task 6.4, N5): structural checks over
 * the draft payload + declared test cases. Failures never block submission
 * — they attach to the review materials.
 */
export function runDraftGate(payloadRaw: unknown): GateResult {
  const failures: string[] = [];
  const check = validateDraftPayload(payloadRaw);
  if (!check.ok) {
    return {
      passed: false,
      failures: check.errors,
      summary: `payload invalid: ${check.errors.join("; ")}`,
    };
  }
  const payload = check.value;
  if (!payload.tests) failures.push("no test cases declared (tests.cases)");
  else {
    const cases = (payload.tests as { cases?: unknown[] }).cases;
    if (!Array.isArray(cases) || cases.length === 0) {
      failures.push("test cases array is empty");
    }
  }
  if (!payload.prompts?.system?.trim()) failures.push("system prompt missing");
  if (payload.ui.type === "form-result") {
    const fields = (payload.ui.schema as { fields?: unknown[] }).fields;
    if (!Array.isArray(fields) || fields.length === 0) {
      failures.push("form-result schema has no fields");
    }
  }
  if (payload.ui.type === "document-flow") {
    const upload = (payload.ui.schema as { uploadField?: { name?: string } }).uploadField;
    if (!upload?.name) failures.push("document-flow schema missing uploadField");
  }
  return {
    passed: failures.length === 0,
    failures,
    summary:
      failures.length === 0
        ? "自动测试通过：结构校验 ✓ 测试用例 ✓ 系统提示词 ✓ UI Schema ✓"
        : `自动测试失败 ${failures.length} 项（仍可提交审核）：${failures.join("；")}`,
  };
}

/** Persist the gate result onto the draft for the reviewer. */
export function attachGateResult(db: ForgegentDb, draftId: string, result: GateResult): void {
  rawExec(
    db,
    "UPDATE agent_drafts SET auto_test_result = ? WHERE id = ?",
    JSON.stringify(result),
    draftId,
  );
}

export function readGateResult(db: ForgegentDb, draftId: string): GateResult | null {
  const row = rawQuery<{ auto_test_result: string | null }>(
    db,
    "SELECT auto_test_result FROM agent_drafts WHERE id = ?",
    draftId,
  )[0];
  return row?.auto_test_result
    ? (JSON.parse(row.auto_test_result) as GateResult)
    : null;
}

/** Submit with the gate (registry submit + gate attach). */
export async function submitWithGate(
  db: ForgegentDb,
  params: { draftId: string; builderId: string },
) {
  const payloadRow = rawQuery<{ draft_payload: string }>(
    db,
    "SELECT draft_payload FROM agent_drafts WHERE id = ?",
    params.draftId,
  )[0];
  if (!payloadRow) throw new Error("draft payload missing");
  const gate = runDraftGate(JSON.parse(payloadRow.draft_payload));
  attachGateResult(db, params.draftId, gate);
  const submitted = await registrySubmit(db, params);
  return { submitted, gate };
}

/* ------------------------- preview test runs (6.3) ------------------------- */

/**
 * Isolated preview execution: materialise an unpublished snapshot for the
 * draft and create an origin=test task owned by the builder. Test tasks stay
 * out of employee task lists (N4) and never touch the active release.
 */
export async function createDraftTestRun(
  db: ForgegentDb,
  store: import("@forgegent/registry").ReleaseStore,
  params: { draftId: string; builderId: string; inputSummary: string },
): Promise<{ taskId: string; testReleaseId: string }> {
  const row = rawQuery<{ agent_id: string; builder_id: string; draft_payload: string; state: string }>(
    db,
    "SELECT agent_id, builder_id, draft_payload, state FROM agent_drafts WHERE id = ?",
    params.draftId,
  )[0];
  if (!row) throw new Error("draft not found");
  if (row.builder_id !== params.builderId) {
    throw new Error("only the draft owner may run preview tests (D19)");
  }
  if (row.state !== "editing") {
    throw new Error(`draft is ${row.state}; preview tests need an editing draft`);
  }
  const payload = JSON.parse(row.draft_payload) as import("@forgegent/registry").DraftPayload;
  const { randomUUID } = await import("node:crypto");
  const releaseId = `test-${randomUUID()}`;
  const snapshot = store.writeSnapshot({
    releaseId,
    agentId: row.agent_id,
    version: `test-${releaseId.slice(5, 13)}`,
    payload,
    publishedBy: params.builderId,
  });
  const { agentReleases, toolPolicies } = await import("@forgegent/db");
  await db.insert(agentReleases).values({
    id: releaseId,
    agentId: row.agent_id,
    version: snapshot.version,
    immutablePackagePath: releaseId,
    checksum: snapshot.checksum,
    publishedBy: params.builderId,
  });
  for (const toolId of payload.toolRefs ?? []) {
    await db.insert(toolPolicies).values({
      id: randomUUID(),
      releaseId,
      toolId,
      resourceScope: null,
      allowedActions: "invoke",
    });
  }
  const { createTask } = await import("@forgegent/tasks");
  const task = await createTask(db, {
    ownerId: params.builderId,
    roles: ["builder"],
    agentId: row.agent_id,
    inputSummary: params.inputSummary,
    origin: "test",
    mode: payload.runtime.mode,
    agentReleaseIdOverride: releaseId,
  });
  return { taskId: task.id, testReleaseId: releaseId };
}
