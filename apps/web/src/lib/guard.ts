/**
 * Server-side authorization guard (task 1.5, permission-enforcement spec).
 *
 * Deny by default: every guarded API resolves the session from the cookie,
 * loads the user's roles from user_roles, and checks the ability matrix.
 * Denials are written to audit_logs with actor/action/reason and no secrets.
 */
import { can, effectiveAbilities, type Ability } from "@forgegent/shared";
import { audit, rolesForUser, isUserActive, rawQuery } from "@forgegent/db";
import type { ForgegentDb } from "@forgegent/db";
import type { Auth } from "./auth";

export interface GuardContext {
  userId: string;
  email: string;
  roles: string[];
  abilities: Set<Ability>;
}

export type GuardResult =
  | { ok: true; context: GuardContext }
  | { ok: false; status: 401 | 403; reason: string };

/** Resolve cookie header → session → user + roles; never trusts client data. */
export async function guardRequest(
  auth: Auth,
  db: ForgegentDb,
  cookieHeader: string | null,
  ability: Ability,
): Promise<GuardResult> {
  const request = new Request("http://local/api/auth/get-session", {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
  const response = await auth.handler(request);
  if (!response.ok) return { ok: false, status: 401, reason: "no-session" };
  const session = (await response.json().catch(() => null)) as {
    session?: { userId: string | null };
    user?: { id: string; email: string; status?: string } | null;
  } | null;
  if (!session || typeof session !== "object") {
    return { ok: false, status: 401, reason: "no-session" };
  }
  const user = session.user;
  if (!session.session?.userId || !user) {
    return { ok: false, status: 401, reason: "no-session" };
  }
  // D22: disabled users lose access immediately.
  if (!(await isUserActive(db, user.id))) {
    await audit(db, {
      actorId: user.id,
      action: "auth.session",
      decision: "deny",
      reason: "user-disabled",
    });
    return { ok: false, status: 401, reason: "user-disabled" };
  }

  // Task 1.4 (D14 server-side enforcement): a user flagged
  // must_change_password may not use ANY guarded API until the change is
  // done — only the change-password route (outside this guard) stays
  // reachable. The login-page redirect is UX, this is the enforcement.
  const forced = rawQuery<{ must_change_password: number }>(
    db,
    "SELECT must_change_password FROM users WHERE id = ?",
    user.id,
  )[0];
  if (forced?.must_change_password) {
    await audit(db, {
      actorId: user.id,
      action: "auth.session",
      decision: "deny",
      reason: "password-change-required",
    });
    return { ok: false, status: 403, reason: "password-change-required" };
  }

  const roleNames = (await rolesForUser(db, user.id)) as Ability[] extends never
    ? never
    : ("admin" | "builder" | "employee")[];
  if (!can(roleNames, ability)) {
    await audit(db, {
      actorId: user.id,
      action: `ability:${ability}`,
      decision: "deny",
      reason: `roles=[${roleNames.join(",")}] lack ${ability}`,
    });
    return { ok: false, status: 403, reason: "forbidden" };
  }

  return {
    ok: true,
    context: {
      userId: user.id,
      email: user.email,
      roles: roleNames,
      abilities: effectiveAbilities(roleNames),
    },
  };
}
