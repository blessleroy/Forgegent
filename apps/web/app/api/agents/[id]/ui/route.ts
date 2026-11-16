import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { agentReleases, rawQuery } from "@forgegent/db";
import { canUseAgent } from "@forgegent/registry";
import { getReleaseStore } from "@/lib/server";
import { guardRequest } from "@/lib/guard";
import { ensureBootstrap, getAuth, getDb } from "@/lib/server";

/**
 * GET /api/agents/[id]/ui — the active release's UI schema for authorized
 * users (FR-03.2). Served from the immutable release snapshot, never live
 * drafts.
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
  const usable = await canUseAgent(getDb(), {
    userId: guard.context.userId,
    roles: guard.context.roles as ("admin" | "builder" | "employee")[],
    agentId: id,
  });
  if (!usable) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const active = rawQuery<{ active_release_id: string | null }>(
    getDb(),
    "SELECT active_release_id FROM agents WHERE id = ?",
    id,
  )[0];
  if (!active?.active_release_id) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  const release = await getDb()
    .select()
    .from(agentReleases)
    .where(eq(agentReleases.id, active.active_release_id))
    .get();
  if (!release) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  const snapshot = getReleaseStore().loadSnapshot(release.id, release.checksum);
    const ui = snapshot.payload.ui;
  // Assemble the renderer schema: { template, ...fields } from the payload.
  const inner = (ui.schema ?? {}) as Record<string, unknown>;
  return NextResponse.json({
    schema: { template: ui.type, ...inner },
  });
}
