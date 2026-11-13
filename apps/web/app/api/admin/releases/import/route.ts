import { NextResponse } from "next/server";
import { audit } from "@forgegent/db";
import { importBundleToDraft } from "@forgegent/registry";
import { guardRequest } from "@/lib/guard";
import { ensureBootstrap, getAuth, getDb } from "@/lib/server";

/**
 * POST /api/admin/releases/import — create a fresh draft from a bundle.
 * Imported drafts stay editing and require full re-authorization + review
 * before production (FR-02.4).
 */
export async function POST(request: Request) {
  await ensureBootstrap();
  const guard = await guardRequest(
    getAuth(),
    getDb(),
    request.headers.get("cookie"),
    "agent.release.import",
  );
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: guard.status });
  }
  const body = (await request.json().catch(() => null)) as {
    bundleJson?: string;
    slug?: string;
  } | null;
  if (!body?.bundleJson || !body?.slug) {
    return NextResponse.json(
      { error: "bundleJson and slug are required" },
      { status: 400 },
    );
  }
  try {
    const draft = await importBundleToDraft(getDb(), {
      bundleJson: body.bundleJson,
      builderId: guard.context.userId,
      slug: body.slug,
    });
    await audit(getDb(), {
      actorId: guard.context.userId,
      action: "agent.release.import",
      resourceType: "agent_draft",
      resourceId: draft.draftId,
      decision: "allow",
    });
    return NextResponse.json(draft, { status: 201 });
  } catch (error) {
    const code = (error as { code?: string }).code ?? "ERROR";
    return NextResponse.json({ error: code }, { status: 400 });
  }
}
