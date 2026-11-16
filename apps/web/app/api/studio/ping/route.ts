import { NextResponse } from "next/server";
import { guardRequest } from "@/lib/guard";
import { ensureBootstrap, getAuth, getDb } from "@/lib/server";

/** Example guarded endpoint: Studio surface requires builder powers (AT-17). */
export async function GET(request: Request) {
  await ensureBootstrap();
  const guard = await guardRequest(
    getAuth(),
    getDb(),
    request.headers.get("cookie"),
    "agent.draft.create",
  );
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.reason },
      { status: guard.status },
    );
  }
  return NextResponse.json({ ok: true, roles: guard.context.roles });
}
