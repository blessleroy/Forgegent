import { NextResponse } from "next/server";
import { rawQuery } from "@forgegent/db";
import { guardRequest } from "@/lib/guard";
import { ensureBootstrap, getAuth, getDb } from "@/lib/server";

/**
 * GET /api/admin/tasks/[id]/usage — model usage and cost for a task
 * (audit-observability spec: admins query per-task usage).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await ensureBootstrap();
  const { id } = await params;
  const guard = await guardRequest(
    getAuth(),
    getDb(),
    request.headers.get("cookie"),
    "usage.view",
  );
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: guard.status });
  }
  const usage = rawQuery(
    getDb(),
    "SELECT model, input_tokens AS inputTokens, output_tokens AS outputTokens, estimated_cost AS estimatedCost, created_at AS createdAt FROM usage_records WHERE task_id = ? ORDER BY created_at",
    id,
  );
  const events = rawQuery<{ event_type: string; safe_payload: string | null; created_at: number }>(
    getDb(),
    "SELECT event_type, safe_payload, created_at FROM task_events WHERE task_id = ? ORDER BY seq",
    id,
  );
  return NextResponse.json({ usage, events });
}
