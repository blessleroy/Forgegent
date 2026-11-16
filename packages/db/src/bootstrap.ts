/**
 * Initial admin bootstrap (task 1.6, D14): when the users table is empty and
 * FORGEGENT_ADMIN_EMAIL / FORGEGENT_ADMIN_PASSWORD are set, create the first
 * admin with must-change-password enforcement on first login.
 */
import { and, eq } from "drizzle-orm";
import { roles, userRoles, users } from "./schema.js";
import type { ForgegentDb } from "./index.js";

export interface InitialAdminEnv {
  adminEmail?: string | undefined;
  adminPassword?: string | undefined;
}

export interface InitialAdminResult {
  created: boolean;
  userId?: string;
  reason?: "table-not-empty" | "env-missing";
}

/** Idempotent: creates the first admin only on an empty users table. */
export async function ensureInitialAdmin(
  db: ForgegentDb,
  env: InitialAdminEnv,
  createUser: (email: string, password: string) => Promise<{ id: string }>,
): Promise<InitialAdminResult> {
  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length > 0) {
    return { created: false, reason: "table-not-empty" };
  }
  if (!env.adminEmail || !env.adminPassword) {
    return { created: false, reason: "env-missing" };
  }

  const user = await createUser(env.adminEmail, env.adminPassword);
  const adminRole = await db
    .select()
    .from(roles)
    .where(eq(roles.name, "admin"))
    .get();
  if (!adminRole) throw new Error("roles table not seeded — migration missing");

  await db.insert(userRoles).values({
    userId: user.id,
    roleId: adminRole.id,
  });
  await db
    .update(users)
    .set({ mustChangePassword: true, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  return { created: true, userId: user.id };
}

/** Roles for a user (identity-access spec) — server-side source of truth. */
export async function rolesForUser(
  db: ForgegentDb,
  userId: string,
): Promise<string[]> {
  const rows = await db
    .select({ roleName: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId));
  return rows.map((r) => r.roleName);
}

/** Active status check for login gating (D22). */
export async function isUserActive(
  db: ForgegentDb,
  userId: string,
): Promise<boolean> {
  const row = await db
    .select({ status: users.status })
    .from(users)
    .where(and(eq(users.id, userId)))
    .get();
  return row?.status === "active";
}
