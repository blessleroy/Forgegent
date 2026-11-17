import { NextResponse } from "next/server";
import { rawQuery } from "@forgegent/db";
import { cancelTask, continueTask, getTaskForUser } from "@forgegent/tasks";
import { guardRequest } from "@/lib/guard";
import { ensureBootstrap, getAuth, getDb } from "@/lib/server";

/** GET /api/tasks/[id] — task detail + output artifacts (owner/admin, N7). */
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
    "agent.use",
  );
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: guard.status });
  }
  try {
    const task = await getTaskForUser(getDb(), {
      taskId: id,
      userId: guard.context.userId,
      roles: guard.context.roles,
    });
    // Remediation 2.14: the task's produced artifacts (成果区) — downloads
    // go through the ACL-checked file endpoint.
    const outputFiles = rawQuery(
      getDb(),
      `SELECT f.id, f.filename, f.mime, f.size
       FROM task_file_refs r JOIN files f ON f.id = r.file_id
       WHERE r.task_id = ? AND r.direction = 'output' AND f.deleted_at IS NULL
       ORDER BY f.created_at`,
      id,
    );
    return NextResponse.json({ task, outputFiles });
  } catch {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
}

/**
 * POST /api/tasks/[id] — message-style continue (D27: waiting_input replies
 * and terminal-state continuations share this endpoint) and cancel.
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
    "agent.use",
  );
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: guard.status });
  }
  const body = (await request.json().catch(() => null)) as {
    action?: "continue" | "cancel";
    message?: string;
  } | null;
  try {
    if (body?.action === "cancel") {
      const task = await cancelTask(getDb(), {
        taskId: id,
        userId: guard.context.userId,
        roles: guard.context.roles,
      });
      return NextResponse.json({ task });
    }
    const task = await continueTask(getDb(), {
      taskId: id,
      userId: guard.context.userId,
      roles: guard.context.roles,
      message: body?.message ?? "",
    });
    return NextResponse.json({ task });
  } catch (error) {
    const code = (error as { code?: string }).code ?? "ERROR";
    return NextResponse.json({ error: code }, { status: 400 });
  }
}
