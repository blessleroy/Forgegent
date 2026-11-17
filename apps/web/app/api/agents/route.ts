import { NextResponse } from "next/server";
import { audit, rawExec } from "@forgegent/db";
import {
  delistAgent,
  rollbackToRelease,
  setAgentGrants,
  listAgentsForUser,
} from "@forgegent/registry";
import { guardRequest } from "@/lib/guard";
import { ensureBootstrap, getAuth, getDb } from "@/lib/server";

/**
 * GET /api/agents — agents visible to the caller (AT-03: authorization
 * filtered; absent grants = admin only).
 */
export async function GET(request: Request) {
  await ensureBootstrap();
  const guard = await guardRequest(
    getAuth(),
    getDb(),
    request.headers.get("cookie"),
    "agent.use",
  );
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: guard.status });
  }
  const agents = await listAgentsForUser(getDb(), {
    userId: guard.context.userId,
    roles: guard.context.roles as ("admin" | "builder" | "employee")[],
  });
  return NextResponse.json({ agents });
}

/**
 * POST /api/agents — admin management actions (grants / delist / rollback).
 */
export async function POST(request: Request) {
  await ensureBootstrap();
  const guard = await guardRequest(
    getAuth(),
    getDb(),
    request.headers.get("cookie"),
    "agent.release.publish",
  );
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: guard.status });
  }
  const body = (await request.json().catch(() => null)) as {
    action?: "set-grants" | "delist" | "rollback" | "set-category" | "create-category";
    agentId?: string;
    grants?: { subjectType: string; subjectId?: string }[];
    releaseId?: string;
    categoryId?: string | null;
    categoryName?: string;
  } | null;
  if (!body?.action || !body.agentId) {
    return NextResponse.json(
      { error: "action and agentId are required" },
      { status: 400 },
    );
  }
  const db = getDb();
  try {
    if (body.action === "set-grants") {
      const grants = (body.grants ?? []).map((g) =>
        g.subjectType === "all_users"
          ? { subjectType: "all_users" as const }
          : g.subjectType === "user"
            ? {
                subjectType: "user" as const,
                subjectId: g.subjectId ?? "",
              }
            : {
                subjectType: "department" as const,
                subjectId: g.subjectId ?? "",
              },
      );
      await setAgentGrants(db, { agentId: body.agentId, grants });
    } else if (body.action === "set-category") {
      // N9: admin-assigned Hub category (nullable → 未分类).
      rawExec(
        db,
        "UPDATE agents SET category_id = ? WHERE id = ?",
        body.categoryId ?? null,
        body.agentId,
      );
    } else if (body.action === "create-category") {
      if (!body.categoryName?.trim()) throw new Error("categoryName required");
      const id = `cat-${crypto.randomUUID().slice(0, 8)}`;
      rawExec(
        db,
        "INSERT INTO categories (id, name) VALUES (?, ?)",
        id,
        body.categoryName.trim(),
      );
      return NextResponse.json({ ok: true, categoryId: id });
    } else if (body.action === "delist") {
      await delistAgent(db, { agentId: body.agentId, adminId: guard.context.userId });
    } else if (body.action === "rollback") {
      if (!body.releaseId) throw new Error("releaseId required for rollback");
      await rollbackToRelease(db, {
        agentId: body.agentId,
        releaseId: body.releaseId,
        adminId: guard.context.userId,
      });
    }
    await audit(db, {
      actorId: guard.context.userId,
      action: `agent.manage:${body.action}`,
      resourceType: "agent",
      resourceId: body.agentId,
      decision: "allow",
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const code = (error as { code?: string }).code ?? "ERROR";
    return NextResponse.json({ error: code }, { status: 400 });
  }
}
