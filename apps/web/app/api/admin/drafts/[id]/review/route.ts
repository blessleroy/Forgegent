import { NextResponse } from "next/server";
import { audit } from "@forgegent/db";
import { reviewDraft } from "@forgegent/registry";
import { guardRequest } from "@/lib/guard";
import { ensureBootstrap, getAuth, getDb, getReleaseStore } from "@/lib/server";

/** POST /api/admin/drafts/[id]/review — approve (publish) or reject. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await ensureBootstrap();
  const { id } = await params;
  const guard = await guardRequest(
    getAuth(),
    getDb(),
    request.headers.get("cookie"),
    "agent.release.review",
  );
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: guard.status });
  }
  const body = (await request.json().catch(() => null)) as {
    decision?: "approve" | "reject";
    note?: string;
  } | null;
  if (body?.decision !== "approve" && body?.decision !== "reject") {
    return NextResponse.json(
      { error: "decision must be approve or reject" },
      { status: 400 },
    );
  }
  try {
    const outcome = await reviewDraft(getDb(), getReleaseStore(), {
      draftId: id,
      adminId: guard.context.userId,
      decision: body.decision,
      note: body.note,
    });
    await audit(getDb(), {
      actorId: guard.context.userId,
      action: `agent.review:${body.decision}`,
      resourceType: "agent_draft",
      resourceId: id,
      decision: "allow",
    });
    return NextResponse.json(outcome);
  } catch (error) {
    const code = (error as { code?: string }).code ?? "ERROR";
    return NextResponse.json({ error: code }, { status: 400 });
  }
}
