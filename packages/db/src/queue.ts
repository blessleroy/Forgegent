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
  const now = Date.now();
  const leaseUntil = new Date(now + leaseSeconds * 1000);
  const row = clientOf(db)
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
                 AND o.lease_until > ?
                 AND o.state IN ('starting', 'running', 'waiting_input')
             )
           )
         ORDER BY t.created_at, t.id
         LIMIT 1
       )
       RETURNING id, owner_id, agent_release_id, state, origin, mode,
                 input_summary, session_id, budget`,
    )
    .get(leaseOwner, leaseUntil.getTime(), now) as ClaimedTask | undefined;
  return row ?? null;
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

/** Terminal transition for a leased task (state machine enforced upstream). */
export function finishLeasedTask(
  db: ForgegentDb,
  taskId: string,
  leaseOwner: string,
  state: "completed" | "failed" | "cancelled" | "interrupted" | "running" | "waiting_input",
): boolean {
  const result = clientOf(db)
    .prepare(
      `UPDATE tasks SET state = ?, lease_owner = NULL, lease_until = NULL
       WHERE id = ? AND lease_owner = ?`,
    )
    .run(state, taskId, leaseOwner);
  return (result as { changes: number }).changes > 0;
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
