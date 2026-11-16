import { NextResponse } from "next/server";
import { rawQuery } from "@forgegent/db";
import { guardRequest } from "@/lib/guard";
import { ensureBootstrap, getAuth, getDb } from "@/lib/server";

/** GET /api/admin/audit?decision=&actor=&limit= — filtered audit trail. */
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
  return NextResponse.json({ logs: rows });
}
