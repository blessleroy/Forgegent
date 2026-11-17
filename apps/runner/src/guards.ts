/**
 * Execution guards (task 7.6 + remediation 1.2/2.13): deadline enforcement,
 * pre-execution cancel checks, in-flight cancel watching with best-effort
 * abort, and sandbox teardown on every exit path. waiting_input time is
 * never counted against the deadline (the race only covers the active run).
 */
import type { ForgegentDb } from "@forgegent/db";
import { appendTaskEvent, finishLeasedTask, rawQuery } from "@forgegent/db";
import type { ClaimedTask } from "@forgegent/db";
import type { SandboxManager } from "@forgegent/sandbox";

export interface GuardedRunOptions {
  /** Max active execution time (waiting_input excluded by construction). */
  timeoutMs: number;
  /** Budget in tokens/cost is enforced upstream; deadline here. */
  sandbox?: SandboxManager;
  /** Receives the run plus the abort signal (cancel/timeout, task 1.2). */
  run(signal: AbortSignal): Promise<"completed" | "failed" | "waiting_input">;
}

/** Interval between in-flight cancel checks (task 1.2 best-effort abort). */
const CANCEL_WATCH_INTERVAL_MS = 2000;

/**
 * Deadline race: exceeding the budget aborts the run (best effort — the
 * signal disposes the pi session), reports a structured failure (N6) and
 * always tears down the sandbox.
 */
export async function runGuarded(
  db: ForgegentDb,
  task: ClaimedTask,
  options: GuardedRunOptions,
): Promise<"completed" | "failed" | "waiting_input"> {
  const controller = new AbortController();
  let timedOut = false;
  // Watch for user/admin cancellation while the run is in flight: the state
  // flip to `cancelled` triggers the abort signal (task 1.2 — 尽力中止).
  const watcher = setInterval(() => {
    const row = rawQuery<{ state: string }>(
      db,
      "SELECT state FROM tasks WHERE id = ?",
      task.id,
    )[0];
    if (row && row.state === "cancelled") {
      controller.abort();
    }
  }, CANCEL_WATCH_INTERVAL_MS);
  try {
    const result = await Promise.race([
      options.run(controller.signal),
      new Promise<"failed">((resolve) => {
        setTimeout(() => {
          timedOut = true;
          controller.abort();
          resolve("failed");
        }, options.timeoutMs);
      }),
    ]);
    if (timedOut) {
      appendTaskEvent(db, task.id, "run.failed", {
        reason: `execution exceeded time budget (${options.timeoutMs}ms) — safely terminated`,
      });
    }
    return result;
  } finally {
    clearInterval(watcher);
    if (options.sandbox && task.sessionId) {
      await options.sandbox.teardown(task.sessionId);
    }
  }
}

/** Skip execution entirely for tasks cancelled while queued (FR-06.4). */
export function isCancelledBeforeRun(
  db: ForgegentDb,
  taskId: string,
): boolean {
  const row = rawQuery<{ state: string }>(
    db,
    "SELECT state FROM tasks WHERE id = ?",
    taskId,
  )[0];
  return row?.state === "cancelled";
}

/** Scheduler-facing wrapper: cancel check + guarded run + lease finish. */
export async function executeGuardedTask(
  db: ForgegentDb,
  task: ClaimedTask,
  leaseOwner: string,
  options: GuardedRunOptions,
): Promise<void> {
  if (isCancelledBeforeRun(db, task.id)) {
    appendTaskEvent(db, task.id, "task.skipped", {
      reason: "cancelled before execution",
    });
    finishLeasedTask(db, task.id, leaseOwner, "cancelled");
    return;
  }
  const outcome = await runGuarded(db, task, options);
  finishLeasedTask(db, task.id, leaseOwner, outcome);
}
