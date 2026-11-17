import { NextResponse } from "next/server";
import { rawQuery } from "@forgegent/db";
import { guardRequest } from "@/lib/guard";
import { ensureBootstrap, getAuth, getDb } from "@/lib/server";

/**
 * GET /api/admin/audit?decision=&actor=&action=&limit= — filtered audit
 * trail. Remediation 4.4 adds:
 * - `action` filter (substring match across audit actions);
 * - `failures=1`: recent run.failed TASK events (运行失败查询, PRD §4);
 * - `denyStats=1`: deny counts over a window (拒绝操作数聚合, §11.3).
 */
export async function GET(request: Request) {
  await ensureBootstrap();
  const guard = await guardRequest(
    getAuth(),
    getDb(),
    request.headers.get("cookie"),
    "audit.view",
  );
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: guard.status });
  }
  const url = new URL(request.url);
  const decision = url.searchParams.get("decision") ?? "";
  const actor = url.searchParams.get("actor") ?? "";
  const action = url.searchParams.get("action") ?? "";
  const limit = Math.min(500, Number(url.searchParams.get("limit") ?? 100));

  const conditions: string[] = ["1=1"];
  const params: unknown[] = [];
  if (decision) {
    conditions.push("a.decision = ?");
    params.push(decision);
  }
  if (actor) {
    conditions.push("u.email LIKE ?");
    params.push(`%${actor}%`);
  }
  if (action) {
    conditions.push("a.action LIKE ?");
    params.push(`%${action}%`);
  }
  const rows = rawQuery(
    getDb(),
    `SELECT a.id, a.action, a.resource_type AS resourceType, a.resource_id AS resourceId,
            a.decision, a.reason, a.created_at AS createdAt,
            u.email AS actorEmail
     FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY a.created_at DESC, a.rowid DESC
     LIMIT ?`,
    ...params,
    limit,
  );

  // 运行失败查询: latest run.failed events with the owning task.
  const failures = url.searchParams.get("failures") === "1"
    ? rawQuery(
        getDb(),
        `SELECT e.task_id AS taskId, e.safe_payload AS safePayload, e.created_at AS createdAt,
                t.state AS taskState
         FROM task_events e JOIN tasks t ON t.id = e.task_id
         WHERE e.event_type = 'run.failed'
         ORDER BY e.created_at DESC LIMIT 50`,
      )
    : undefined;

  // 拒绝操作数聚合: denials in the last 24h, total and per action prefix.
  const denyStats = url.searchParams.get("denyStats") === "1"
    ? {
        last24h: rawQuery<{ count: number }>(
          getDb(),
          "SELECT COUNT(*) AS count FROM audit_logs WHERE decision = 'deny' AND created_at > ?",
          Date.now() - 24 * 3600 * 1000,
        )[0]?.count ?? 0,
        byAction: rawQuery<{ action: string; count: number }>(
          getDb(),
          `SELECT action, COUNT(*) AS count FROM audit_logs
           WHERE decision = 'deny' AND created_at > ?
           GROUP BY action ORDER BY count DESC LIMIT 10`,
          Date.now() - 24 * 3600 * 1000,
        ),
      }
    : undefined;

  return NextResponse.json({ logs: rows, failures, denyStats });
}
