/**
 * Forgegent shared contracts.
 *
 * Types here are the platform-level vocabulary shared between the Next.js web
 * app and the runner process. They mirror the OpenSpec specs
 * (`openspec/specs` after archive; change `forgegent-v1-platform` until then):
 * identity-access (roles), task-execution (task states),
 * studio-building (draft states).
 */

/** Platform roles (identity-access spec). */
export const ROLES = ["admin", "builder", "employee"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Task lifecycle states (task-execution spec).
 *
 * Legal transitions:
 *   pending -> starting -> running
 *   running -> waiting_input ; waiting_input -> running
 *   pending/starting/running/waiting_input -> cancelled (user or admin)
 *   running/waiting_input -> failed (failure / timeout / budget)
 *   executing + runner crash / lease expiry -> interrupted
 *   completed/failed/cancelled/interrupted -> running (via continue)
 */
export const TASK_STATES = [
  "pending",
  "starting",
  "running",
  "waiting_input",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
] as const;
export type TaskState = (typeof TASK_STATES)[number];

/** Terminal states; all four are continue-able per spec. */
export const TERMINAL_TASK_STATES: readonly TaskState[] = [
  "completed",
  "failed",
  "cancelled",
  "interrupted",
];

/**
 * Agent draft states (studio-building spec):
 * editing -> in_review -> (rejected -> editing | approved -> release)
 */
export const DRAFT_STATES = ["editing", "in_review", "rejected", "approved"] as const;
export type DraftState = (typeof DRAFT_STATES)[number];

/** Task origin (studio test runs stay out of employee task lists). */
export const TASK_ORIGINS = ["staff", "test"] as const;
export type TaskOrigin = (typeof TASK_ORIGINS)[number];

/** Execution modes (sandbox-isolation spec). */
export const EXECUTION_MODES = ["restricted", "sandboxed"] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

/** Legal task state transition table (task-execution spec). */
export const TASK_TRANSITIONS: Readonly<Record<TaskState, readonly TaskState[]>> = {
  pending: ["starting", "cancelled"],
  starting: ["running", "cancelled", "interrupted"],
  running: ["waiting_input", "completed", "failed", "cancelled", "interrupted"],
  waiting_input: ["running", "failed", "cancelled", "interrupted"],
  // Terminal states: continue requeues the same task+session as pending.
  completed: ["pending"],
  failed: ["pending"],
  cancelled: ["pending"],
  interrupted: ["pending"],
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export * from "./permissions.js";
