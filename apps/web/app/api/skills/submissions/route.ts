import { NextResponse } from "next/server";
import { audit } from "@forgegent/db";
import { submitSkill, SkillStore } from "@forgegent/skills";
import { dataDir, ensureBootstrap, getAuth, getDb } from "@/lib/server";
import { guardRequest } from "@/lib/guard";
import { join } from "node:path";

const skillStore = new SkillStore(join(dataDir(), "skills"));

/**
 * POST /api/skills/submissions — any signed-in user may submit (FR-04.2).
 * The package (SKILL.md + optional auxiliary files) is PERSISTED: what the
 * admin approves is exactly what was submitted (remediation 2.5).
 */
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
    /** Optional auxiliary files (relative path → content). */
    files?: Record<string, string>;
  } | null;
  if (!body?.name || !body.markdown?.trim()) {
    return NextResponse.json(
      { error: "name and markdown (SKILL.md content) required" },
      { status: 400 },
    );
  }
  for (const path of Object.keys(body.files ?? {})) {
    if (path.includes("..") || path.startsWith("/")) {
      return NextResponse.json({ error: `unsafe file path: ${path}` }, { status: 400 });
    }
  }
  const { submissionId } = submitSkill(getDb(), skillStore, {
    submitterId: guard.context.userId,
    pkg: { name: body.name, markdown: body.markdown, files: body.files },
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
