import { NextResponse } from "next/server";
import { createTask, listTasksForUser } from "@forgegent/tasks";
import { guardRequest } from "@/lib/guard";
import { ensureBootstrap, getAuth, getDb } from "@/lib/server";

/** POST /api/tasks — create a task on the agent's active release. */
export async function POST(request: Request) {
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
  const body = (await request.json().catch(() => null)) as {
    agentId?: string;
    inputSummary?: string;
    inputFileIds?: string[];
  } | null;
  if (!body?.agentId || !body?.inputSummary) {
    return NextResponse.json(
      { error: "agentId and inputSummary are required" },
      { status: 400 },
    );
  }
  try {
    const task = await createTask(getDb(), {
      ownerId: guard.context.userId,
      roles: guard.context.roles,
      agentId: body.agentId,
      inputSummary: body.inputSummary,
      inputFileIds: body.inputFileIds,
    });
    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    const code = (error as { code?: string }).code ?? "ERROR";
    return NextResponse.json({ error: code }, { status: 400 });
  }
}

/** GET /api/tasks — the caller's own staff tasks (N4). */
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
  return NextResponse.json({ tasks: listTasksForUser(getDb(), guard.context.userId) });
}
