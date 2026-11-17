import { NextResponse } from "next/server";
import { withdrawDraft } from "@forgegent/registry";
import { resolveBuilderBackend, submitWithGate } from "@forgegent/studio";
import { guardRequest } from "@/lib/guard";
import { ensureBootstrap, getAuth, getDb, getReleaseStore } from "@/lib/server";

/** POST /api/studio/drafts/[id]/submit — submit for review (owner only).
 *  Remediation 4.2: submissions run through the REAL gate (static checks +
 *  isolated test run when online / offline label, D41/N5). */
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
    if (body.action === "withdraw") {
      const draft = await withdrawDraft(getDb(), {
        draftId: id,
        builderId: guard.context.userId,
      });
      return NextResponse.json(draft);
    }
    const { submitted, gate } = await submitWithGate(getDb(), {
      draftId: id,
      builderId: guard.context.userId,
      store: getReleaseStore(),
      backendMode: resolveBuilderBackend(getDb()).kind,
    });
    return NextResponse.json({ ...submitted, gate });
  } catch (error) {
    const code = (error as { code?: string }).code ?? "ERROR";
    return NextResponse.json({ error: code }, { status: 400 });
  }
}
