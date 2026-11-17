/**
 * Task event append (task-execution spec): task_events is the single event
 * source for SSE with per-task monotonic sequence numbers (resume by id).
 */
import { randomUUID } from "node:crypto";
import type { ForgegentDb } from "./index.js";
import { redact } from "./audit.js";

/**
 * Append a sanitized event; returns the allocated sequence number.
 *
 * Task 1.7 (remediation #12): every payload passes through the same redact()
 * used by audit logs — secret-shaped keys/values (sk-, Bearer, long hex) are
 * masked before persistence, so nothing unredacted can reach the SSE stream
 * or the events replay API regardless of the writer.
 */
export function appendTaskEvent(
  db: ForgegentDb,
  taskId: string,
  eventType: string,
  safePayload?: Record<string, unknown>,
): number {
  type Client = {
    prepare(sql: string): {
      get(...p: unknown[]): unknown;
      run(...p: unknown[]): unknown;
    };
  };
  const client = (db as unknown as { $client: Client }).$client;
  const row = client
    .prepare("SELECT coalesce(max(seq), 0) + 1 AS next FROM task_events WHERE task_id = ?")
    .get(taskId) as { next: number };
  const seq = row.next;
  client
    .prepare(
      "INSERT INTO task_events (id, task_id, seq, event_type, safe_payload) VALUES (?, ?, ?, ?, ?)",
    )
    .run(
      randomUUID(),
      taskId,
      seq,
      eventType,
      safePayload ? JSON.stringify(redact(safePayload)) : null,
    );
  return seq;
}

/** Read events after a sequence number (SSE resume). */
export function readTaskEvents(
  db: ForgegentDb,
  taskId: string,
  afterSeq = 0,
): { seq: number; eventType: string; safePayload: unknown }[] {
  type Client = {
    prepare(sql: string): {
      all(...p: unknown[]): unknown[];
    };
  };
  const client = (db as unknown as { $client: Client }).$client;
  const rows = client
    .prepare(
      "SELECT seq, event_type AS eventType, safe_payload AS safePayload FROM task_events WHERE task_id = ? AND seq > ? ORDER BY seq",
    )
    .all(taskId, afterSeq) as {
    seq: number;
    eventType: string;
    safePayload: string | null;
  }[];
  return rows.map((row) => ({
    seq: row.seq,
    eventType: row.eventType,
    safePayload:
      row.safePayload === null ? null : (JSON.parse(row.safePayload) as unknown),
  }));
}
