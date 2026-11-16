import { NextResponse } from "next/server";
import { readTaskEvents } from "@forgegent/db";
import { getTaskForUser } from "@forgegent/tasks";
import { guardRequest } from "@/lib/guard";
import { ensureBootstrap, getAuth, getDb } from "@/lib/server";

/**
 * GET /api/tasks/[id]/events?after=N — event history / SSE resume read.
 * Clients pass their last seen seq to backfill without duplicates
 * (PRD §10: reconnect must not re-execute or skip events).
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
    "agent.use",
  );
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: guard.status });
  }
  try {
    await getTaskForUser(getDb(), {
      taskId: id,
      userId: guard.context.userId,
      roles: guard.context.roles,
    });
  } catch {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  const after = Number(new URL(request.url).searchParams.get("after") ?? 0);
  const events = readTaskEvents(getDb(), id, Number.isFinite(after) ? after : 0);
  return NextResponse.json({ events });
}
