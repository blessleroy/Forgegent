/**
 * Published releases visible to a builder (for the copy-to-draft picker, D19).
 */
import { NextResponse } from "next/server";
import { rawQuery } from "@forgegent/db";
import { guardRequest } from "@/lib/guard";
import { ensureBootstrap, getAuth, getDb } from "@/lib/server";

export async function GET(request: Request) {
  await ensureBootstrap();
  const guard = await guardRequest(
    getAuth(),
    getDb(),
    request.headers.get("cookie"),
    "agent.draft.create",
  );
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: guard.status });
  }
  const releases = rawQuery(
    getDb(),
    `SELECT ar.id, ar.version, a.slug, a.name,
            (a.active_release_id = ar.id) AS isActive
     FROM agent_releases ar JOIN agents a ON a.id = ar.agent_id
     WHERE a.listing_state = 'listed' OR ar.published_by = ?
     ORDER BY ar.created_at DESC`,
    guard.context.userId,
  );
  return NextResponse.json({ releases });
}
