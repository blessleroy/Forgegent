import { NextResponse } from "next/server";
import { copyReleaseToDraft } from "@forgegent/registry";
import { guardRequest } from "@/lib/guard";
import { ensureBootstrap, getAuth, getDb, getReleaseStore } from "@/lib/server";
import { checkSameOrigin } from "@/lib/csrf";

/**
 * POST /api/studio/copy-release — Builder copies any published version into
 * a fresh draft they own (D19).
 */
export async function POST(request: Request) {
  await ensureBootstrap();
  const csrf = checkSameOrigin(request);
  if (csrf) return csrf;
  const guard = await guardRequest(
    getAuth(),
    getDb(),
    request.headers.get("cookie"),
    "agent.draft.create",
  );
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: guard.status });
  }
  const body = (await request.json().catch(() => null)) as {
    releaseId?: string;
  } | null;
  if (!body?.releaseId) {
    return NextResponse.json({ error: "releaseId required" }, { status: 400 });
  }
  try {
    const draft = await copyReleaseToDraft(getDb(), getReleaseStore(), {
      releaseId: body.releaseId,
      builderId: guard.context.userId,
    });
    return NextResponse.json(draft, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: String((error as Error).message).slice(0, 200) },
      { status: 400 },
    );
  }
}
