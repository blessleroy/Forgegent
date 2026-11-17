/**
 * Task queue primitives (task-execution spec; design D3).
 *
 * SQLite-backed lease queue for the single runner process:
 * - claimNextTask: atomic lease acquisition (owner + lease_until) that skips
 *   tasks whose session already has an active lease (session exclusive lock).
 * - renewLease / releaseLease / failLeased: lease lifecycle.
 * - reclaimStaleLeases: crashed runner recovery -> interrupted (AT-15).
 */
import { randomUUID } from "node:crypto";
import type { ForgegentDb } from "./index.js";
import { appendTaskEvent } from "./events.js";

/** States that hold an active lease on a session. */
const ACTIVE_STATES = ["starting", "running", "waiting_input"] as const;

export interface ClaimedTask {
  id: string;
  ownerId: string;
  agentReleaseId: string;
  state: string;
  origin: string;
  mode: string;
  inputSummary: string | null;
  sessionId: string | null;
  /** Queued employee follow-ups consumed by this round (remediation 2.12). */
  pendingFollowup?: string | null;
  budget: unknown;
}

type Client = {
  prepare(sql: string): {
    get(...p: unknown[]): unknown;
    run(...p: unknown[]): unknown;
    all(...p: unknown[]): unknown[];
  };
};

function clientOf(db: ForgegentDb): Client {
  return (db as unknown as { $client: Client }).$client;
}

export function claimNextTask(
  db: ForgegentDb,
  leaseOwner: string,
  leaseSeconds: number,
): ClaimedTask | null {
  const client = clientOf(db);
  const now = Date.now();
  const leaseUntil = new Date(now + leaseSeconds * 1000);

  // 1) Fresh pending tasks (pending -> starting).
  //    Session exclusivity (D39): a session blocks while any of its tasks is
  //    actively leased OR waiting for user input — even without a lease.
  const pending = client
    .prepare(
      `UPDATE tasks
       SET state = 'starting', lease_owner = ?, lease_until = ?
       WHERE id = (
         SELECT t.id FROM tasks t
         WHERE t.state = 'pending'
           AND (
             t.session_id IS NULL
             OR t.session_id NOT IN (
               SELECT o.session_id FROM tasks o
               WHERE o.session_id IS NOT NULL
                 AND o.session_id = t.session_id
                 AND o.id != t.id
                 AND (
                   (o.lease_until > ? AND o.state IN ('starting', 'running'))
                   OR o.state = 'waiting_input'
                 )
             )
           )
         ORDER BY t.created_at, t.id
         LIMIT 1
       )
       RETURNING id, owner_id AS ownerId, agent_release_id AS agentReleaseId,
                 state, origin, mode,
                 input_summary AS inputSummary, session_id AS sessionId,
                 pending_followup AS pendingFollowup, budget`,
    )
    .get(leaseOwner, leaseUntil.getTime(), now) as ClaimedTask | undefined;
  if (pending) return pending;

  // 2) Resumable tasks (remediation 2.11/2.12): `running` with NO lease —
  //    the employee replied to a waiting_input task; continueTask flipped it
  //    back to running. We lease in place (state stays running — the task is
  //    already inside its execution lifecycle) and the executor resumes the
  //    session with the queued follow-up. The follow-up is captured BEFORE
  //    being cleared (RETURNING would see the cleared value).
  const candidate = client
    .prepare(
      `SELECT t.id FROM tasks t
       WHERE t.state = 'running'
         AND t.lease_owner IS NULL
         AND t.lease_until IS NULL
         AND (
           t.session_id IS NULL
           OR t.session_id NOT IN (
             SELECT o.session_id FROM tasks o
             WHERE o.session_id IS NOT NULL
               AND o.session_id = t.session_id
               AND o.id != t.id
               AND (
                 (o.lease_until > ? AND o.state IN ('starting', 'running'))
                 OR o.state = 'waiting_input'
               )
           )
         )
       ORDER BY t.created_at, t.id
       LIMIT 1`,
    )
    .get(now) as { id: string } | undefined;
  if (!candidate) return null;
  const captured = client
    .prepare(
      `SELECT id, owner_id AS ownerId, agent_release_id AS agentReleaseId,
              state, origin, mode,
              input_summary AS inputSummary, session_id AS sessionId,
              pending_followup AS pendingFollowup, budget
       FROM tasks WHERE id = ?`,
    )
    .get(candidate.id) as ClaimedTask | undefined;
  const claimed = client
    .prepare(
      `UPDATE tasks SET lease_owner = ?, lease_until = ?, pending_followup = NULL
       WHERE id = ? AND state = 'running' AND lease_owner IS NULL AND lease_until IS NULL`,
    )
    .run(leaseOwner, leaseUntil.getTime(), candidate.id);
  if ((claimed as { changes: number }).changes === 0) return null;
  return captured ?? null;
}

export function renewLease(
  db: ForgegentDb,
  taskId: string,
  leaseOwner: string,
  leaseSeconds: number,
): boolean {
  const result = clientOf(db)
    .prepare(
      `UPDATE tasks SET lease_until = ?
       WHERE id = ? AND lease_owner = ? AND state IN ('starting', 'running', 'waiting_input')`,
    )
    .run(Date.now() + leaseSeconds * 1000, taskId, leaseOwner);
  return (result as { changes: number }).changes > 0;
}

/**
 * Terminal (or waiting_input) transition for a leased task — state machine
 * enforced HERE, not just upstream (task 1.2, remediation review #7).
 *
 * A run that reports an outcome AFTER the user cancelled (or the lease was
 * reclaimed to `interrupted`) must never overwrite that terminal state:
 * outcomes only apply from the active execution states. When the refusal
 * happens while this runner still holds the lease, the lease is released and
 * a `task.finish_refused` event records the refused overwrite attempt.
 */
export function finishLeasedTask(
  db: ForgegentDb,
  taskId: string,
  leaseOwner: string,
  state: "completed" | "failed" | "cancelled" | "interrupted" | "running" | "waiting_input",
): boolean {
  const client = clientOf(db);
  if (state === "cancelled") {
    // Queued-cancel path: the task may already be `cancelled` (cancelled
    // between claim and run) — keep it, release the lease. Otherwise cancel
    // from the active states.
    const result = client
      .prepare(
        `UPDATE tasks
         SET state = CASE WHEN state IN ('starting','running','waiting_input')
                          THEN 'cancelled' ELSE state END,
             lease_owner = NULL, lease_until = NULL
         WHERE id = ? AND lease_owner = ?
           AND (state = 'cancelled' OR state IN ('starting','running','waiting_input'))`,
      )
      .run(taskId, leaseOwner);
    return (result as { changes: number }).changes > 0;
  }
  const result = client
    .prepare(
      `UPDATE tasks SET state = ?, lease_owner = NULL, lease_until = NULL
       WHERE id = ? AND lease_owner = ? AND state IN ('starting','running')`,
    )
    .run(state, taskId, leaseOwner);
  if ((result as { changes: number }).changes > 0) return true;
  // Refused. Distinguish a real anomaly (lease still held under this runner,
  // task left in a terminal state — e.g. user cancelled mid-run) from the
  // benign bookkeeping call after the lease was already closed.
  const held = client
    .prepare(`SELECT state FROM tasks WHERE id = ? AND lease_owner = ?`)
    .get(taskId, leaseOwner) as { state: string } | undefined;
  if (held) {
    client
      .prepare(
        `UPDATE tasks SET lease_owner = NULL, lease_until = NULL
         WHERE id = ? AND lease_owner = ?`,
      )
      .run(taskId, leaseOwner);
    appendTaskEvent(db, taskId, "task.finish_refused", {
      attempted: state,
      kept: held.state,
      reason: "terminal state not overwritten (state machine)",
    });
  }
  return false;
}

/**
 * Recovery sweep (FR-06.6, AT-15): tasks whose lease expired while still in
 * an active state are marked interrupted — never silently completed.
 * Returns the reclaimed task ids.
 */
export function reclaimStaleLeases(db: ForgegentDb): string[] {
  const now = Date.now();
  const rows = clientOf(db)
    .prepare(
      `SELECT id FROM tasks
       WHERE lease_until IS NOT NULL AND lease_until < ?
         AND state IN ('starting', 'running', 'waiting_input')`,
    )
    .all(now) as { id: string }[];
  const reclaimed: string[] = [];
  for (const row of rows) {
    const result = clientOf(db)
      .prepare(
        `UPDATE tasks SET state = 'interrupted', lease_owner = NULL, lease_until = NULL
         WHERE id = ? AND state IN ('starting', 'running', 'waiting_input')`,
      )
      .run(row.id);
    if ((result as { changes: number }).changes > 0) reclaimed.push(row.id);
  }
  return reclaimed;
}

export function newLeaseOwnerId(): string {
  return `runner-${randomUUID().slice(0, 8)}`;
}
