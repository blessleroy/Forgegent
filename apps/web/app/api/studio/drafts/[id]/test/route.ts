import { NextResponse } from "next/server";
import { createDraftTestRun, readConversation, submitWithGate } from "@forgegent/studio";
import { guardRequest } from "@/lib/guard";
import { ensureBootstrap, getAuth, getDb, getReleaseStore } from "@/lib/server";

/**
 * POST /api/studio/drafts/[id]/test — isolated preview run (origin=test,
 * bound to the unpublished draft snapshot).
 */
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
    "agent.draft.test",
  );
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: guard.status });
  }
  const body = (await request.json().catch(() => ({}))) as {
    action?: "run-test" | "submit";
    inputSummary?: string;
  };
  try {
    if (body.action === "submit") {
      const { submitted, gate } = await submitWithGate(getDb(), {
        draftId: id,
        builderId: guard.context.userId,
      });
      return NextResponse.json({ submitted, gate });
    }
    const run = await createDraftTestRun(getDb(), getReleaseStore(), {
      draftId: id,
      builderId: guard.context.userId,
      inputSummary: body.inputSummary ?? "预览测试运行",
    });
    return NextResponse.json(run, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 },
    );
  }
}

/** GET — conversation log for this draft (owner-only, N4). */
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
    "agent.draft.test",
  );
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: guard.status });
  }
  return NextResponse.json({ messages: readConversation(getDb(), id) });
}
