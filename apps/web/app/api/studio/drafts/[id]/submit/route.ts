import { NextResponse } from "next/server";
import { submitDraft, withdrawDraft } from "@forgegent/registry";
import { guardRequest } from "@/lib/guard";
import { ensureBootstrap, getAuth, getDb } from "@/lib/server";

/** POST /api/studio/drafts/[id]/submit — submit for review (owner only). */
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
    "agent.draft.submit",
  );
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: guard.status });
  }
  const body = (await request.json().catch(() => ({}))) as {
    action?: "submit" | "withdraw";
  };
  try {
    const draft =
      body.action === "withdraw"
        ? await withdrawDraft(getDb(), {
            draftId: id,
            builderId: guard.context.userId,
          })
        : await submitDraft(getDb(), {
            draftId: id,
            builderId: guard.context.userId,
          });
    return NextResponse.json(draft);
  } catch (error) {
    const code = (error as { code?: string }).code ?? "ERROR";
    return NextResponse.json({ error: code }, { status: 400 });
  }
}
