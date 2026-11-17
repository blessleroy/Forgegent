import { NextResponse } from "next/server";
import {
  createDraftTestRun,
  readConversation,
  resolveBuilderBackend,
  submitWithGate,
} from "@forgegent/studio";
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
        store: getReleaseStore(),
        backendMode: resolveBuilderBackend(getDb()).kind,
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

/** GET — conversation log + draft payload (owner-only, N4). The payload
 *  powers the employee-view preview (R4.1). */
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
  const row = (
    getDb() as unknown as {
      $client: { prepare(s: string): { get(...p: unknown[]): unknown } };
    }
  ).$client
    .prepare("SELECT draft_payload, review_note FROM agent_drafts WHERE id = ?")
    .get(id) as { draft_payload: string; review_note: string | null } | undefined;
  return NextResponse.json({
    messages: readConversation(getDb(), id),
    payload: row ? JSON.parse(row.draft_payload) : null,
    reviewNote: row?.review_note ?? null,
  });
}
