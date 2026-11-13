import { NextResponse } from "next/server";
import { cancelTask, continueTask, getTaskForUser } from "@forgegent/tasks";
import { guardRequest } from "@/lib/guard";
import { ensureBootstrap, getAuth, getDb } from "@/lib/server";

/** GET /api/tasks/[id] — task detail (owner/admin only, N7). */
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
    return NextResponse.json({ task });
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
