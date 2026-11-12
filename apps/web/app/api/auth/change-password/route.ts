import { NextResponse } from "next/server";
import { audit, rawExec } from "@forgegent/db";
import { ensureBootstrap, getAuth, getDb } from "@/lib/server";

/**
 * Forced first-login password change (D14). Requires an authenticated
 * session and the current (initial) password; clears must_change_password
 * on success and revokes other sessions.
 */
export async function POST(request: Request) {
  await ensureBootstrap();
  const auth = getAuth();
  const db = getDb();

  const body = (await request.json().catch(() => null)) as {
    currentPassword?: string;
    newPassword?: string;
  } | null;
  if (!body?.currentPassword || !body?.newPassword) {
    return NextResponse.json(
      { error: "current-and-new-password-required" },
      { status: 400 },
    );
  }
  if (body.newPassword.length < 8) {
    return NextResponse.json({ error: "password-too-short" }, { status: 400 });
  }

  try {
    await auth.api.changePassword({
      headers: { cookie: request.headers.get("cookie") ?? "" },
      body: {
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
        revokeOtherSessions: true,
      },
    });
  } catch {
    const sessionRes = await auth.handler(
      new Request("http://local/api/auth/get-session", {
        headers: { cookie: request.headers.get("cookie") ?? "" },
      }),
    );
    const session = (await sessionRes.json().catch(() => null)) as {
      user?: { id: string } | null;
    } | null;
    await audit(db, {
      actorId: session?.user?.id ?? undefined,
      action: "auth.change-password",
      decision: "deny",
      reason: "current-password-mismatch",
    });
    return NextResponse.json({ error: "change-failed" }, { status: 400 });
  }

  const sessionRes = await auth.handler(
    new Request("http://local/api/auth/get-session", {
      headers: { cookie: request.headers.get("cookie") ?? "" },
    }),
  );
  const session = (await sessionRes.json().catch(() => null)) as {
    user?: { id: string } | null;
  } | null;
  if (!session?.user) {
    return NextResponse.json({ error: "no-session" }, { status: 401 });
  }

  // Raw SQL helper: avoids pulling a second drizzle-orm instance into the
  // web bundle (pnpm peer-split typing conflicts).
  rawExec(
    db,
    "UPDATE users SET must_change_password = 0, updated_at = ? WHERE id = ?",
    Date.now(),
    session.user.id,
  );
  await audit(db, {
    actorId: session.user.id,
    action: "auth.change-password",
    decision: "allow",
  });
  return NextResponse.json({ ok: true });
}
