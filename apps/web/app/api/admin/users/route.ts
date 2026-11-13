import { NextResponse } from "next/server";
import { audit, rawExec, rawQuery } from "@forgegent/db";
import { guardRequest } from "@/lib/guard";
import { ensureBootstrap, getAuth, getDb } from "@/lib/server";

const VALID_ROLES = new Set(["admin", "builder", "employee"]);

/**
 * GET /api/admin/users — list users with roles and departments.
 * POST /api/admin/users — create a user (invite) with roles + departments.
 */
export async function GET(request: Request) {
  await ensureBootstrap();
  const guard = await guardRequest(
    getAuth(),
    getDb(),
    request.headers.get("cookie"),
    "user.manage",
  );
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: guard.status });
  }
  const users = rawQuery(
    getDb(),
    `SELECT u.id, u.email, u.name, u.status,
            (SELECT group_concat(r.name, ',') FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id) AS roles,
            (SELECT group_concat(d.name, ',') FROM user_departments ud JOIN departments d ON d.id = ud.department_id WHERE ud.user_id = u.id) AS departments
     FROM users u ORDER BY u.created_at`,
  );
  return NextResponse.json({ users });
}

export async function POST(request: Request) {
  await ensureBootstrap();
  const guard = await guardRequest(
    getAuth(),
    getDb(),
    request.headers.get("cookie"),
    "user.manage",
  );
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: guard.status });
  }
  const body = (await request.json().catch(() => null)) as {
    action?: "create" | "set-roles" | "reset-password" | "set-status" | "set-departments" | "create-department";
    email?: string;
    password?: string;
    name?: string;
    userId?: string;
    roles?: string[];
    departmentIds?: string[];
    departmentName?: string;
    status?: "active" | "disabled";
  } | null;
  if (!body?.action) {
    return NextResponse.json({ error: "action required" }, { status: 400 });
  }
  const db = getDb();
  try {
    if (body.action === "create") {
      if (!body.email || !body.password || body.password.length < 8) {
        return NextResponse.json(
          { error: "email and password (>=8 chars) required" },
          { status: 400 },
        );
      }
      for (const role of body.roles ?? []) {
        if (!VALID_ROLES.has(role)) {
          return NextResponse.json({ error: `invalid role: ${role}` }, { status: 400 });
        }
      }
      const created = await getAuth().api.signUpEmail({
        body: { email: body.email, password: body.password, name: body.name ?? body.email },
        asResponse: false,
      });
      for (const role of body.roles ?? []) {
        rawExec(
          db,
          "INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)",
          created.user.id,
          `role-${role}`,
        );
      }
      for (const deptId of body.departmentIds ?? []) {
        rawExec(
          db,
          "INSERT OR IGNORE INTO user_departments (user_id, department_id) VALUES (?, ?)",
          created.user.id,
          deptId,
        );
      }
      await audit(db, {
        actorId: guard.context.userId,
        action: "user.create",
        resourceType: "user",
        resourceId: created.user.id,
        decision: "allow",
      });
      return NextResponse.json({ userId: created.user.id }, { status: 201 });
    }

    if (body.action === "set-roles") {
      if (!body.userId || !Array.isArray(body.roles)) {
        return NextResponse.json({ error: "userId and roles required" }, { status: 400 });
      }
      for (const role of body.roles) {
        if (!VALID_ROLES.has(role)) {
          return NextResponse.json({ error: `invalid role: ${role}` }, { status: 400 });
        }
      }
      rawExec(db, "DELETE FROM user_roles WHERE user_id = ?", body.userId);
      for (const role of body.roles) {
        rawExec(
          db,
          "INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)",
          body.userId,
          `role-${role}`,
        );
      }
      await audit(db, {
        actorId: guard.context.userId,
        action: "user.set-roles",
        resourceType: "user",
        resourceId: body.userId,
        decision: "allow",
        payload: { roles: body.roles },
      });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "reset-password") {
      if (!body.userId || !body.password || body.password.length < 8) {
        return NextResponse.json(
          { error: "userId and password (>=8) required" },
          { status: 400 },
        );
      }
      // Reset via a fresh credential + forced change on next login.
      const auth = getAuth();
      const target = rawQuery<{ email: string }>(
        db,
        "SELECT email FROM users WHERE id = ?",
        body.userId,
      )[0];
      if (!target) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
      rawExec(
        db,
        "DELETE FROM accounts WHERE user_id = ? AND provider_id = 'credential'",
        body.userId,
      );
      await auth.api.signUpEmail({
        body: { email: target.email, password: body.password, name: target.email },
        asResponse: false,
      });
      rawExec(
        db,
        "UPDATE users SET must_change_password = 1 WHERE id = ?",
        body.userId,
      );
      await audit(db, {
        actorId: guard.context.userId,
        action: "user.reset-password",
        resourceType: "user",
        resourceId: body.userId,
        decision: "allow",
      });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "set-status") {
      if (!body.userId || (body.status !== "active" && body.status !== "disabled")) {
        return NextResponse.json(
          { error: "userId and status (active|disabled) required" },
          { status: 400 },
        );
      }
      rawExec(db, "UPDATE users SET status = ? WHERE id = ?", body.status, body.userId);
      await audit(db, {
        actorId: guard.context.userId,
        action: `user.${body.status}`,
        resourceType: "user",
        resourceId: body.userId,
        decision: "allow",
      });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "set-departments") {
      if (!body.userId || !Array.isArray(body.departmentIds)) {
        return NextResponse.json(
          { error: "userId and departmentIds required" },
          { status: 400 },
        );
      }
      rawExec(db, "DELETE FROM user_departments WHERE user_id = ?", body.userId);
      for (const deptId of body.departmentIds) {
        rawExec(
          db,
          "INSERT OR IGNORE INTO user_departments (user_id, department_id) VALUES (?, ?)",
          body.userId,
          deptId,
        );
      }
      await audit(db, {
        actorId: guard.context.userId,
        action: "user.set-departments",
        resourceType: "user",
        resourceId: body.userId,
        decision: "allow",
      });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "create-department") {
      if (!body.departmentName?.trim()) {
        return NextResponse.json({ error: "departmentName required" }, { status: 400 });
      }
      const id = `dept-${crypto.randomUUID().slice(0, 8)}`;
      rawExec(
        db,
        "INSERT INTO departments (id, name) VALUES (?, ?)",
        id,
        body.departmentName.trim(),
      );
      await audit(db, {
        actorId: guard.context.userId,
        action: "department.create",
        resourceType: "department",
        resourceId: id,
        decision: "allow",
      });
      return NextResponse.json({ departmentId: id }, { status: 201 });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: String((error as Error).message).slice(0, 200) },
      { status: 400 },
    );
  }
}
