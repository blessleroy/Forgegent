import { rawQuery, readTaskEvents } from "@forgegent/db";
import { getTaskForUser } from "@forgegent/tasks";
import { guardRequest } from "@/lib/guard";
import { ensureBootstrap, getAuth, getDb } from "@/lib/server";

/**
 * GET /api/tasks/[id]/stream — SSE progress stream (FR-06.5).
 *
 * Sanitized task events only (task_events is written post-filter by
 * construction); reconnecting clients resume with ?after=<lastSeq>.
 * Page close does not affect execution — the stream is read-only.
 */
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
    return new Response("unauthorized", { status: guard.status });
  }
  try {
    await getTaskForUser(getDb(), {
      taskId: id,
      userId: guard.context.userId,
      roles: guard.context.roles,
    });
  } catch {
    return new Response("not found", { status: 404 });
  }

  const url = new URL(request.url);
  let lastSeq = Number(url.searchParams.get("after") ?? 0) || 0;
  const encoder = new TextEncoder();
  const pollMs = 1000;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };
      request.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
      send("open", { taskId: id, lastSeq });

      const timer = setInterval(() => {
        if (closed) return;
        try {
          const events = readTaskEvents(getDb(), id, lastSeq);
          for (const event of events) {
            lastSeq = event.seq;
            send("task-event", event);
          }
          const state = rawQuery<{ state: string }>(
            getDb(),
            "SELECT state FROM tasks WHERE id = ?",
            id,
          )[0]?.state ?? "unknown";
          if (["completed", "failed", "cancelled", "interrupted"].includes(state)) {
            send("done", { state, lastSeq });
            closed = true;
            clearInterval(timer);
            controller.close();
          }
        } catch {
          closed = true;
          clearInterval(timer);
          try {
            controller.close();
          } catch {
            /* noop */
          }
        }
      }, pollMs);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
