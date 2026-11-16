/**
 * AT-06 regression (task 5.3): employees forging API calls to change
 * model/skill/tool configuration get 403 everywhere and production rows are
 * untouched.
 */
import { describe, expect, it } from "vitest";
import {
  createTestDb,
  rawExec,
  rawQuery,
  users,
} from "@forgegent/db";
import { createAuth } from "../src/lib/auth.js";
import { guardRequest } from "../src/lib/guard.js";
import type { Ability } from "@forgegent/shared";

const db = createTestDb();
const auth = createAuth(db, [], { rateLimitMax: 1000 });

async function signIn(email: string, password: string): Promise<string> {
  const res = await auth.handler(
    new Request("http://local/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),
  );
  if (!res.ok) {
    throw new Error(`sign-in failed ${res.status}: ${await res.text()}`);
  }
  return (res.headers.get("set-cookie") ?? "").split(";")[0]!;
}

async function snapshotProdConfig() {
  return JSON.stringify({
    resources: rawQuery(db, "SELECT * FROM resources"),
    grants: rawQuery(db, "SELECT * FROM agent_grants"),
    policies: rawQuery(db, "SELECT * FROM tool_policies"),
    releases: rawQuery(db, "SELECT id, version, checksum FROM agent_releases"),
  });
}

describe("AT-06 — forged config changes are rejected everywhere", () => {
  it("employee with a valid session cannot pass any config-changing guard", async () => {
    // Seed an employee with a real session.
    const { user } = await auth.api.signUpEmail({
      body: { email: "emp@at06.local", password: "password123", name: "emp" },
      asResponse: false,
    });
    await db.insert(users).values({ id: user.id, email: "emp@at06.local" }).onConflictDoNothing();
    rawExec(
      db,
      "INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'role-employee')",
      user.id,
    );
    const cookie = await signIn("emp@at06.local", "password123");
    const before = await snapshotProdConfig();

    const configAbilities: Ability[] = [
      "resource.manage",
      "resource.grant",
      "model.manage",
      "skill.review",
      "skill.grant_binding",
      "agent.release.publish",
      "agent.release.review",
      "agent.release.rollback",
      "agent.release.delist",
      "agent.release.import",
      "user.manage",
    ];
    for (const ability of configAbilities) {
      const guard = await guardRequest(auth, db, cookie, ability);
      expect(guard.ok, `${ability} must be denied`).toBe(false);
      if (!guard.ok) expect(guard.status).toBe(403);
    }

    // Production configuration is byte-identical after the barrage.
    expect(await snapshotProdConfig()).toBe(before);
    // And the denials are audited.
    const denies = rawQuery<{ action: string }>(
      db,
      "SELECT action FROM audit_logs WHERE decision = 'deny' AND action LIKE 'ability:%'",
    );
    expect(denies.length).toBeGreaterThanOrEqual(configAbilities.length);
  });

  it("admins keep full config access (positive control)", async () => {
    const { user: admin } = await auth.api.signUpEmail({
      body: { email: "admin@at06.local", password: "password123", name: "admin" },
      asResponse: false,
    });
    await db.insert(users).values({ id: admin.id, email: "admin@at06.local" }).onConflictDoNothing();
    rawExec(
      db,
      "INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'role-admin')",
      admin.id,
    );    const cookie = await signIn("admin@at06.local", "password123");
    const guard = await guardRequest(auth, db, cookie, "model.manage");
    expect(guard.ok).toBe(true);
  });
});
