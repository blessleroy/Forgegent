import { NextResponse } from "next/server";
import { audit } from "@forgegent/db";
import { submitSkill } from "@forgegent/skills";
import { guardRequest } from "@/lib/guard";
import { ensureBootstrap, getAuth, getDb } from "@/lib/server";

/** POST /api/skills/submissions — any signed-in user may submit (FR-04.2). */
export async function POST(request: Request) {
  await ensureBootstrap();
  const guard = await guardRequest(
    getAuth(),
    getDb(),
    request.headers.get("cookie"),
    "skill.submit",
  );
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: guard.status });
  }
  const body = (await request.json().catch(() => null)) as {
    name?: string;
    markdown?: string;
  } | null;
  if (!body?.name || !body.markdown?.trim()) {
    return NextResponse.json(
      { error: "name and markdown (SKILL.md content) required" },
      { status: 400 },
    );
  }
  const { submissionId } = submitSkill(getDb(), {
    submitterId: guard.context.userId,
    pkg: { name: body.name, markdown: body.markdown },
  });
  await audit(getDb(), {
    actorId: guard.context.userId,
    action: "skill.submit",
    resourceType: "skill_submission",
    resourceId: submissionId,
    decision: "allow",
  });
  return NextResponse.json({ submissionId, state: "pending" }, { status: 201 });
}
