import { NextResponse } from "next/server";
import { rolesForUser } from "@forgegent/db";
import { guardRequest } from "@/lib/guard";
import { ensureBootstrap, getAuth, getDb } from "@/lib/server";

/** GET /api/me — current user + roles (drives nav visibility). */
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
  return NextResponse.json({
    userId: guard.context.userId,
    email: guard.context.email,
    roles: guard.context.roles,
  });
}
void rolesForUser;
