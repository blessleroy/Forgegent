/**
 * Integration tests for identity-access (tasks 1.4/1.5/1.6).
 * Runs a real Better Auth instance over an in-memory SQLite database — no
 * Next.js server needed; we call auth.handler with fetch Requests.
 */
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, ensureInitialAdmin, rolesForUser, users, auditLogs } from "@forgegent/db";
import { createAuth } from "../src/lib/auth.js";
import { guardRequest } from "../src/lib/guard.js";

const BASE = "http://local/api/auth";

async function signIn(
  auth: ReturnType<typeof createAuth>,
  email: string,
  password: string,
) {
  return auth.handler(
    new Request(`${BASE}/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),
  );
}

async function seedUser(
  auth: ReturnType<typeof createAuth>,
  email: string,
  password: string,
) {
  const res = await auth.api.signUpEmail({
    body: { email, password, name: email.split("@")[0]! },
    asResponse: false,
  });
  return res.user;
}

describe("task 1.4 — credential auth (identity-access spec)", () => {
  it("signs in with correct credentials and sets a hardened cookie", async () => {
    const db = createTestDb();
    const auth = createAuth(db);
    await seedUser(auth, "alice@test.local", "password123");
    const res = await signIn(auth, "alice@test.local", "password123");
    expect(res.status).toBe(200);
    const cookie = (res.headers.get("set-cookie") ?? "").toLowerCase();
    expect(cookie).toContain("httponly");
    expect(cookie).toContain("samesite=lax");
    const body = (await res.json()) as { user: { email: string } };
    expect(body.user.email).toBe("alice@test.local");
  });

  it("rejects wrong credentials without leaking validity", async () => {
    const db = createTestDb();
    const auth = createAuth(db);
    await seedUser(auth, "alice@test.local", "password123");
    const bad = await signIn(auth, "alice@test.local", "wrong-pass-1");
    expect(bad.ok).toBe(false);
    const ghost = await signIn(auth, "ghost@test.local", "whatever-xx");
    expect(ghost.ok).toBe(false);
  });

  it("expired sessions are rejected", async () => {
    const db = createTestDb();
    const auth = createAuth(db);
    await seedUser(auth, "alice@test.local", "password123");
    const res = await signIn(auth, "alice@test.local", "password123");
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
    // Force expiry of every secondary-storage record (incl. session).
    db.$client.prepare("UPDATE kv_store SET expires_at = 1").run();
    const guard = await guardRequest(auth, db, cookie, "agent.use");
    expect(guard.ok).toBe(false);
    if (!guard.ok) expect(guard.status).toBe(401);
  });

  it("brute-force attempts are rate limited", async () => {
    const db = createTestDb();
    const auth = createAuth(db);
    await seedUser(auth, "bob@test.local", "password123");
    let limited = false;
    for (let i = 0; i < 12; i++) {
      const res = await signIn(auth, "bob@test.local", "wrong-pass-x");
      if (res.status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });
});

describe("task 1.5 — role guard (permission-enforcement spec)", () => {
  it("employee forging agent-creation APIs gets 403 + audit trail", async () => {
    const db = createTestDb();
    const auth = createAuth(db);
    const user = await seedUser(auth, "emp@test.local", "password123");
    // employee role (seeded in migration 0001)
    db.$client
      .prepare(
        "INSERT INTO user_roles (user_id, role_id) VALUES (?, 'role-employee')",
      )
      .run(user.id);

    const res = await signIn(auth, "emp@test.local", "password123");
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
    const guard = await guardRequest(auth, db, cookie, "agent.draft.create");
    expect(guard.ok).toBe(false);
    if (!guard.ok) expect(guard.status).toBe(403);

    const denies = db.$client
      .prepare(
        "SELECT action, decision FROM audit_logs WHERE decision = 'deny'",
      )
      .all() as { action: string; decision: string }[];
    expect(denies.length).toBeGreaterThan(0);
    expect(denies.some((d) => d.action.includes("agent.draft.create"))).toBe(
      true,
    );
  });

  it("builder passes builder-gated checks but not admin ones", async () => {
    const db = createTestDb();
    const auth = createAuth(db);
    const user = await seedUser(auth, "builder@test.local", "password123");
    db.$client
      .prepare(
        "INSERT INTO user_roles (user_id, role_id) VALUES (?, 'role-builder')",
      )
      .run(user.id);
    const res = await signIn(auth, "builder@test.local", "password123");
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;

    expect((await guardRequest(auth, db, cookie, "agent.draft.create")).ok).toBe(true);
    expect((await guardRequest(auth, db, cookie, "user.manage")).ok).toBe(false);
  });
});

describe("task 1.6 — initial admin bootstrap (D14)", () => {
  it("creates the first admin with forced password change", async () => {
    const db = createTestDb();
    const auth = createAuth(db);
    const result = await ensureInitialAdmin(
      db,
      { adminEmail: "admin@corp.local", adminPassword: "init-pass-123" },
      async (email, password) => {
        const r = await auth.api.signUpEmail({
          body: { email, password, name: "Admin" },
          asResponse: false,
        });
        return { id: r.user.id };
      },
    );
    expect(result.created).toBe(true);
    const row = await db
      .select()
      .from(users)
      .where(eq(users.email, "admin@corp.local"))
      .get();
    expect(row?.mustChangePassword).toBe(true);
    expect(await rolesForUser(db, row!.id)).toEqual(["admin"]);
    // The initial password actually signs in.
    const res = await signIn(auth, "admin@corp.local", "init-pass-123");
    expect(res.status).toBe(200);
  });

  it("is a no-op once users exist or env is missing", async () => {
    const db = createTestDb();
    const auth = createAuth(db);
    await seedUser(auth, "first@test.local", "password123");
    const r1 = await ensureInitialAdmin(
      db,
      { adminEmail: "a@b.c", adminPassword: "x-password-1" },
      async () => {
        throw new Error("must not be called");
      },
    );
    expect(r1.created).toBe(false);

    const db2 = createTestDb();
    const r2 = await ensureInitialAdmin(db2, {}, async () => {
      throw new Error("must not be called");
    });
    expect(r2.created).toBe(false);
  });

  it("disabled users are denied at the guard (D22)", async () => {
    const db = createTestDb();
    const auth = createAuth(db);
    const user = await seedUser(auth, "off@test.local", "password123");
    db.$client
      .prepare(
        "INSERT INTO user_roles (user_id, role_id) VALUES (?, 'role-employee')",
      )
      .run(user.id);
    const res = await signIn(auth, "off@test.local", "password123");
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
    db.$client
      .prepare("UPDATE users SET status = 'disabled' WHERE id = ?")
      .run(user.id);
    const guard = await guardRequest(auth, db, cookie, "agent.use");
    expect(guard.ok).toBe(false);
    if (!guard.ok) expect(guard.status).toBe(401);
    const denies = db.$client
      .prepare("SELECT reason FROM audit_logs WHERE action = 'auth.session'")
      .all() as { reason: string }[];
    expect(denies.some((d) => d.reason === "user-disabled")).toBe(true);
  });
});
