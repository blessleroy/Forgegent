import { NextResponse } from "next/server";
import { resolveBuilderBackend, continueConversation, startConversation } from "@forgegent/studio";
import { rawQuery } from "@forgegent/db";
import { guardRequest } from "@/lib/guard";
import { ensureBootstrap, getAuth, getDb } from "@/lib/server";

/** GET /api/studio/drafts — the builder's drafts + active backend mode.
 *  `builderBackend: "heuristic"` means 离线演示模式 — the Studio UI must
 *  label it (D30: the heuristic fallback never passes itself off as LLM). */
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
  const drafts = rawQuery(
    getDb(),
    `SELECT d.id, d.state, a.slug, json_extract(d.draft_payload, '$.name') AS name,
            json_extract(d.draft_payload, '$.version') AS version,
            d.review_note AS reviewNote,
            d.auto_test_result AS autoTestResult
     FROM agent_drafts d JOIN agents a ON a.id = d.agent_id
     WHERE d.builder_id = ? ORDER BY d.created_at DESC`,
    guard.context.userId,
  );
  return NextResponse.json({
    drafts,
    builderBackend: resolveBuilderBackend(getDb()).kind,
  });
}

/** POST /api/studio/drafts — converse: start a draft or continue editing. */
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
    draftId?: string;
    slug?: string;
    message?: string;
  } | null;
  if (!body?.message?.trim()) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }
  // Task 2.1 (D30/D34/D42): real LLM backend when the admin-configured
  // endpoint is usable; deterministic heuristic otherwise. LLM failures
  // surface as errors — never a silent heuristic swap.
  const backend = resolveBuilderBackend(getDb());
  try {
    if (body.draftId) {
      const result = await continueConversation(getDb(), backend, {
        draftId: body.draftId,
        builderId: guard.context.userId,
        instruction: body.message,
      });
      return NextResponse.json({ ...result, builderBackend: backend.kind });
    }
    if (!body.slug) {
      return NextResponse.json(
        { error: "slug is required to start a draft" },
        { status: 400 },
      );
    }
    const result = await startConversation(getDb(), backend, {
      builderId: guard.context.userId,
      slug: body.slug,
      brief: body.message,
    });
    return NextResponse.json(
      { ...result, builderBackend: backend.kind },
      { status: 201 },
    );
  } catch (error) {
    const code = (error as { code?: string }).code ?? "ERROR";
    return NextResponse.json(
      { error: code, detail: (error as Error).message },
      { status: 400 },
    );
  }
}
