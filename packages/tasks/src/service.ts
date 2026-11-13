/**
 * Task lifecycle service (task-execution spec; tasks 4.1–4.3).
 *
 * - Creation validates agent use permission + binds the immutable release
 *   snapshot (FR-06.1 fields).
 * - State transitions go through the shared state machine (illegal moves
 *   rejected, FR-06.2 / review-corrected transition table).
 * - continue (D17/D27): from any terminal state or waiting_input, the same
 *   task record + session is reused; messages can never alter model/tool/
 *   resource configuration (server-side only).
 * - cancel (FR-06.4): owner or admin; marks cancelled, runner stops tooling.
 * - Visibility: owner or admin only (N7).
 */
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { ForgegentDb } from "@forgegent/db";
import {
  appendTaskEvent,
  audit,
  files,
  rawExec,
  rawQuery,
  taskFileRefs,
  tasks,
} from "@forgegent/db";
import { canTransition, type TaskState } from "@forgegent/shared";
import { canUseAgent } from "@forgegent/registry";

export type TaskErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_STATE"
  | "VALIDATION"
  | "AGENT_NOT_USABLE";

export class TaskError extends Error {
  constructor(
    public readonly code: TaskErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface TaskBudget {
  maxDurationSeconds?: number;
  maxTokens?: number;
  maxCostCents?: number;
}

export interface CreateTaskInput {
  ownerId: string;
  roles: string[];
  agentId: string;
  inputSummary: string;
  inputFileIds?: string[];
  origin?: "staff" | "test";
  mode?: "restricted" | "sandboxed";
  budget?: TaskBudget;
  /** Draft-preview runs bind the unpublished snapshot directly (6.3). */
  agentReleaseIdOverride?: string;
}

export interface TaskRecord {
  id: string;
  ownerId: string;
  agentReleaseId: string;
  state: TaskState;
  origin: string;
  mode: string;
  sessionId: string | null;
  inputSummary: string | null;
}

type Row = typeof tasks.$inferSelect;

function toRecord(row: Row): TaskRecord {
  return {
    id: row.id,
    ownerId: row.ownerId,
    agentReleaseId: row.agentReleaseId,
    state: row.state as TaskState,
    origin: row.origin,
    mode: row.mode,
    sessionId: row.sessionId,
    inputSummary: row.inputSummary,
  };
}

async function getRow(
  db: ForgegentDb,
  taskId: string,
): Promise<Row> {
  const row = await db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!row) throw new TaskError("NOT_FOUND", "task not found");
  return row;
}

/** FR-06.1: creation validates use rights and binds the active release. */
export async function createTask(
  db: ForgegentDb,
  input: CreateTaskInput,
): Promise<TaskRecord> {
  const usable =
    input.origin === "test"
      ? true // Draft test runs are gated by draft ownership upstream (6.3),
              // not by publish grants — the draft is not published yet.
      : await canUseAgent(db, {
          userId: input.ownerId,
          roles: input.roles as ("admin" | "builder" | "employee")[],
          agentId: input.agentId,
        });
  if (!usable) {
    await audit(db, {
      actorId: input.ownerId,
      action: "task.create",
      resourceType: "agent",
      resourceId: input.agentId,
      decision: "deny",
      reason: "no-use-permission",
    });
    throw new TaskError("AGENT_NOT_USABLE", "agent not usable by this user");
  }
  // Deactivated users cannot start new work (D22) — running tasks complete.
  const statusRow = rawQuery<{ status: string }>(
    db,
    "SELECT status FROM users WHERE id = ?",
    input.ownerId,
  )[0];
  if (statusRow?.status !== "active") {
    throw new TaskError("AGENT_NOT_USABLE", "user is not active");
  }
  let releaseId: string | null = input.agentReleaseIdOverride ?? null;
  if (!releaseId) {
    releaseId = rawQuery<{ active_release_id: string | null }>(
      db,
      "SELECT active_release_id FROM agents WHERE id = ?",
      input.agentId,
    )[0]?.active_release_id ?? null;
  }
  if (!releaseId) {
    throw new TaskError("AGENT_NOT_USABLE", "agent has no active release");
  }
  if (!input.inputSummary?.trim()) {
    throw new TaskError("VALIDATION", "inputSummary is required");
  }
  // Input files must belong to the owner (FR-07 ACL at task creation).
  for (const fileId of input.inputFileIds ?? []) {
    const file = await db
      .select({ ownerId: files.ownerId })
      .from(files)
      .where(and(eq(files.id, fileId), isNull(files.deletedAt)))
      .get();
    if (!file || file.ownerId !== input.ownerId) {
      throw new TaskError("FORBIDDEN", `input file ${fileId} not accessible`);
    }
  }

  const taskId = randomUUID();
  const sessionId = randomUUID(); // stable working session across continues
  await db.insert(tasks).values({
    id: taskId,
    ownerId: input.ownerId,
    agentReleaseId: releaseId,
    state: "pending",
    origin: input.origin ?? "staff",
    mode: input.mode ?? "restricted",
    inputSummary: input.inputSummary,
    budget: input.budget ?? null,
    sessionId,
  });
  for (const fileId of input.inputFileIds ?? []) {
    await db
      .insert(taskFileRefs)
      .values({ taskId, fileId, direction: "input" });
  }
  appendTaskEvent(db, taskId, "task.created", {
    agentId: input.agentId,
    releaseId,
    inputSummary: input.inputSummary,
  });
  return toRecord(
    await getRow(db, taskId),
  );
}

/** State machine enforced transition + event (FR-06.2). */
export async function transitionTask(
  db: ForgegentDb,
  taskId: string,
  from: TaskState,
  to: TaskState,
  event?: string,
): Promise<TaskRecord> {
  if (!canTransition(from, to)) {
    throw new TaskError(
      "INVALID_STATE",
      `illegal transition ${from} -> ${to}`,
    );
  }
  rawExec(db, "UPDATE tasks SET state = ? WHERE id = ? AND state = ?", to, taskId, from);
  const still = await getRow(db, taskId);
  if (still.state !== to) {
    throw new TaskError("INVALID_STATE", `task is no longer in ${from}`);
  }
  appendTaskEvent(db, taskId, event ?? `task.${to}`);
  return toRecord(await getRow(db, taskId));
}

/**
 * Continue (D17/D27): from any terminal state or waiting_input — reuse the
 * same task record + session, back to pending for the runner to pick up.
 * The message is free text; it can never change model/tools/resources.
 */
export async function continueTask(
  db: ForgegentDb,
  params: { taskId: string; userId: string; roles: string[]; message: string },
): Promise<TaskRecord> {
  const row = await getRow(db, params.taskId);
  if (row.ownerId !== params.userId && !params.roles.includes("admin")) {
    throw new TaskError("FORBIDDEN", "only the task owner may continue");
  }
  if (!params.message?.trim()) {
    throw new TaskError("VALIDATION", "message is required");
  }
  const state = row.state as TaskState;
  const allowed: TaskState[] = [
    "completed",
    "failed",
    "cancelled",
    "interrupted",
    "waiting_input",
  ];
  if (!allowed.includes(state)) {
    throw new TaskError(
      "INVALID_STATE",
      `task is ${state}; continue applies to waiting_input or terminal states`,
    );
  }
  // waiting_input resumes the same run; terminal continues requeue as pending
  // for the runner to claim again (session lock keeps exclusivity).
  const next: TaskState = state === "waiting_input" ? "running" : "pending";
  rawExec(db, "UPDATE tasks SET state = ? WHERE id = ? AND state = ?", next, params.taskId, state);
  appendTaskEvent(db, params.taskId, "task.continued", {
    message: params.message.slice(0, 2000),
  });
  appendTaskEvent(
    db,
    params.taskId,
    next === "running" ? "task.running" : "task.pending",
  );
  return toRecord(await getRow(db, params.taskId));
}

/** Cancel (FR-06.4): owner or admin; blocked new tool calls, terminal. */
export async function cancelTask(
  db: ForgegentDb,
  params: { taskId: string; userId: string; roles: string[] },
): Promise<TaskRecord> {
  const row = await getRow(db, params.taskId);
  if (row.ownerId !== params.userId && !params.roles.includes("admin")) {
    throw new TaskError("FORBIDDEN", "only the task owner or admin may cancel");
  }
  const state = row.state as TaskState;
  if (["completed", "failed", "cancelled", "interrupted"].includes(state)) {
    throw new TaskError(
      "INVALID_STATE",
      `task already terminal (${state})`,
    );
  }
  return transitionTask(db, params.taskId, state, "cancelled", "task.cancelled");
}

/** Visibility: owner or admin (N7 — no task sharing in V1). */
export async function getTaskForUser(
  db: ForgegentDb,
  params: { taskId: string; userId: string; roles: string[] },
): Promise<TaskRecord> {
  const row = await getRow(db, params.taskId);
  if (row.ownerId !== params.userId && !params.roles.includes("admin")) {
    throw new TaskError("FORBIDDEN", "task not visible to this user");
  }
  return toRecord(row);
}

/** Employee task list: own tasks, staff origin only (N4). */
export function listTasksForUser(
  db: ForgegentDb,
  userId: string,
): TaskRecord[] {
  const rows = rawQuery<Row>(
    db,
    "SELECT * FROM tasks WHERE owner_id = ? AND origin = 'staff' ORDER BY created_at DESC",
    userId,
  );
  return rows.map(toRecord);
}
