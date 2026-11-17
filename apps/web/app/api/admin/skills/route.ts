import { NextResponse } from "next/server";
import { rawQuery } from "@forgegent/db";
import {
  reviewSkillSubmission,
  revokeSkillVersion,
  SkillStore,
  grantSkillBinding,
} from "@forgegent/skills";
import { dataDir } from "@/lib/server";
import { guardRequest } from "@/lib/guard";
import { ensureBootstrap, getAuth, getDb } from "@/lib/server";
import { join } from "node:path";

const skillStore = new SkillStore(join(dataDir(), "skills"));

/** GET /api/admin/skills — submissions + published versions + bindings. */
export async function GET(request: Request) {
  await ensureBootstrap();
  const guard = await guardRequest(
    getAuth(),
    getDb(),
    request.headers.get("cookie"),
    "skill.review",
  );
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: guard.status });
  }
  const submissions = rawQuery(
    getDb(),
    `SELECT ss.id, ss.review_state AS reviewState, ss.review_note AS reviewNote,
            u.email AS submitterEmail, ss.created_at AS createdAt
     FROM skill_submissions ss JOIN users u ON u.id = ss.submitter_id
     ORDER BY ss.created_at DESC`,
  );
  const versions = rawQuery(
    getDb(),
    `SELECT sv.id, s.slug, sv.version, sv.checksum, sv.status
     FROM skill_versions sv JOIN skills s ON s.id = sv.skill_id
     ORDER BY sv.created_at DESC`,
  );
  return NextResponse.json({ submissions, versions });
}

/** POST /api/admin/skills — review / revoke / grant-binding. */
export async function POST(request: Request) {
  await ensureBootstrap();
  const guard = await guardRequest(
    getAuth(),
    getDb(),
    request.headers.get("cookie"),
    "skill.review",
  );
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: guard.status });
  }
  const body = (await request.json().catch(() => null)) as {
    action?: "approve" | "reject" | "revoke" | "grant-binding";
    submissionId?: string;
    skillVersionId?: string;
    skillId?: string;
    builderId?: string;
    skillName?: string;
    version?: string;
    note?: string;
  } | null;
  if (!body?.action) {
    return NextResponse.json({ error: "action required" }, { status: 400 });
  }
  const db = getDb();
  try {
    if (body.action === "approve" || body.action === "reject") {
      if (!body.submissionId) {
        return NextResponse.json({ error: "submissionId required" }, { status: 400 });
      }
      // Remediation 2.5: the published package IS the submitted content —
      // no markdown is accepted from the review request itself.
      const outcome = await reviewSkillSubmission(db, skillStore, {
        submissionId: body.submissionId,
        reviewerId: guard.context.userId,
        decision: body.action,
        skillName: body.skillName ?? `skill-${body.submissionId.slice(0, 8)}`,
        version: body.version ?? "1.0.0",
        note: body.note,
      });
      return NextResponse.json(outcome);
    }
    if (body.action === "revoke") {
      if (!body.skillVersionId) {
        return NextResponse.json({ error: "skillVersionId required" }, { status: 400 });
      }
      revokeSkillVersion(db, {
        skillVersionId: body.skillVersionId,
        adminId: guard.context.userId,
      });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "grant-binding") {
      if (!body.skillId || !body.builderId) {
        return NextResponse.json(
          { error: "skillId and builderId required" },
          { status: 400 },
        );
      }
      grantSkillBinding(db, {
        skillId: body.skillId,
        builderId: body.builderId,
        adminId: guard.context.userId,
      });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: String((error as Error).message).slice(0, 200) },
      { status: 400 },
    );
  }
}
