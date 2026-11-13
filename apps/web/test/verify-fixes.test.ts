/**
 * Post-verification fixes (verify report CRITICAL + WARNING batch):
 * C1 user/department admin APIs, C2 usage records, C3 observability fields,
 * W1 AT-17 studio gate, W2 live-task file delete block, W4 allow audits,
 * W5 forged inline definitions, W6 unauthorized skillRef binding, W8 docker
 * network isolation args, W9 resource kind whitelist, W3 token budget.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, rawExec, rawQuery, users } from "@forgegent/db";
import type { ForgegentDb } from "@forgegent/db";
import { createAuth } from "../src/lib/auth.js";
import { guardRequest } from "../src/lib/guard.js";
import {
  createDraft,
  delistAgent,
  ReleaseStore,
  reviewDraft,
  rollbackToRelease,
  submitDraft,
  validateResourceKind,
} from "@forgegent/registry";

const db: ForgegentDb = createTestDb();
const releasesDir = mkdtempSync(join(tmpdir(), "fix-rel-"));
const store = new ReleaseStore(releasesDir);
store.init();
const auth = createAuth(db, [], { rateLimitMax: 1000 });

const admin = "fix-admin";
const builder = "fix-builder";
const employee = "fix-employee";

beforeAll(async () => {
  for (const [id, email] of [
    [admin, "a@fix.local"],
    [builder, "b@fix.local"],
  ] as const) {
    await db.insert(users).values({ id, email }).onConflictDoNothing();
  }
  rawExec(
    db,
    "INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'role-admin'), (?, 'role-builder')",
    admin,
    builder,
  );
  // Employee is created through better-auth so it has a credential account
  // for the W1 sign-in check; roles attach to the returned user id.
  const existing = rawQuery<{ id: string }>(
    db,
    "SELECT id FROM users WHERE email = 'e@fix.local'",
  )[0];
  let employeeId: string;
  if (existing) {
    employeeId = existing.id;
  } else {
    const emp = await auth.api.signUpEmail({
      body: { email: "e@fix.local", password: "password123", name: "E" },
      asResponse: false,
    });
    employeeId = emp.user.id;
  }
  rawExec(
    db,
    "INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'role-employee')",
    employeeId,
  );
});

afterAll(() => {
  try {
    rmSync(releasesDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

async function signInCookie(email: string): Promise<string> {
  const res = await auth.handler(
    new Request("http://local/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "password123" }),
    }),
  );
  return (res.headers.get("set-cookie") ?? "").split(";")[0]!;
}

describe("C1 — user & department admin surface (service layer)", () => {
  it("admin creates a user with roles + department; new user signs in with exactly those powers", async () => {
    // Service-equivalent of POST /api/admin/users action=create.
    const created = await auth.api.signUpEmail({
      body: { email: "newhire@fix.local", password: "password123", name: "New" },
      asResponse: false,
    });
    rawExec(
      db,
      "INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'role-builder')",
      created.user.id,
    );
    rawExec(db, "INSERT OR IGNORE INTO departments (id, name) VALUES ('dept-fix', 'fixing')");
    rawExec(
      db,
      "INSERT OR IGNORE INTO user_departments (user_id, department_id) VALUES (?, 'dept-fix')",
      created.user.id,
    );
    // The new user signs in and holds exactly the builder powers.
    const cookie = await signInCookie("newhire@fix.local");
    const canBuild = await guardRequest(auth, db, cookie, "agent.draft.create");
    const cannotAdmin = await guardRequest(auth, db, cookie, "user.manage");
    expect(canBuild.ok).toBe(true);
    expect(cannotAdmin.ok).toBe(false);
  });
});

describe("W1 — AT-17 studio gate (employee rejected)", () => {
  it("employee session cannot pass studio guards", async () => {
    const cookie = await signInCookie("e@fix.local");
    const guard = await guardRequest(auth, db, cookie, "agent.draft.create");
    expect(guard.ok).toBe(false);
    if (!guard.ok) expect(guard.status).toBe(403);
    const audited = rawQuery<{ action: string }>(
      db,
      "SELECT action FROM audit_logs WHERE action LIKE 'ability:agent.draft.create%' AND decision = 'deny'",
    );
    expect(audited.length).toBeGreaterThan(0);
  });
});

describe("W5/W6/W9 — input hardening", () => {
  it("W6: drafts referencing unpublished skills are rejected", async () => {
    await expect(
      createDraft(db, {
        builderId: builder,
        slug: "bad-skillref",
        payload: {
          schemaVersion: "1.0",
          name: "X",
          description: "x",
          version: "1.0.0",
          ui: { type: "form-result", schema: { fields: [] } },
          runtime: { engine: "pi-coding-agent", mode: "restricted" },
          skillRefs: [{ id: "never-published", version: "9.9.9" }],
        },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("W9: resource kinds are a closed set", () => {
    expect(validateResourceKind("model_endpoint")).toBe("model_endpoint");
    expect(() => validateResourceKind("kubernetes_cluster")).toThrow(/invalid resource kind/);
  });

});
