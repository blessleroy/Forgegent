import { NextResponse } from "next/server";
import { audit } from "@forgegent/db";
import { createDraft } from "@forgegent/registry";
import { guardRequest } from "@/lib/guard";
import { ensureBootstrap, getAuth, getDb } from "@/lib/server";

/** POST /api/studio/drafts — create an agent draft (Builder only). */
export async function POST(request: Request) {
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
  const body = (await request.json().catch(() => null)) as {
    slug?: string;
    payload?: unknown;
  } | null;
  if (!body?.slug || !body?.payload) {
    return NextResponse.json(
      { error: "slug and payload are required" },
      { status: 400 },
    );
  }
  try {
    const draft = await createDraft(getDb(), {
      builderId: guard.context.userId,
      slug: body.slug,
      payload: body.payload,
    });
    await audit(getDb(), {
      actorId: guard.context.userId,
      action: "agent.draft.create",
      resourceType: "agent_draft",
      resourceId: draft.draftId,
      decision: "allow",
    });
    return NextResponse.json(draft, { status: 201 });
  } catch (error) {
    const code = (error as { code?: string }).code ?? "ERROR";
    await audit(getDb(), {
      actorId: guard.context.userId,
      action: "agent.draft.create",
      decision: "deny",
      reason: String((error as Error).message).slice(0, 200),
    });
    return NextResponse.json({ error: code }, { status: 400 });
  }
}
