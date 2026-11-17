/**
 * R1 remediation regressions (tasks 1.3 / 1.4 / 1.5 / 1.6) at the web layer:
 * - reset-password: atomic credential swap (no lockout), forced change flag,
 *   full session revocation.
 * - must_change_password: enforced by guardRequest (server-side), not by the
 *   login page redirect.
 * - disabled users: rejected at the auth layer (no session issued) and their
 *   sessions are revoked on disable.
 * - middleware: cross-origin mutating API calls are rejected centrally.
 *
 * The data dir env is set BEFORE importing server-dependent modules (they
 * are lazily bound to FORGEGENT_DATA_DIR singletons).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

process.env.FORGEGENT_DATA_DIR = mkdtempSync(join(tmpdir(), "r1-web-"));

const { getAuth, getDb } = await import("../src/lib/server.js");
const { guardRequest } = await import("../src/lib/guard.js");
const usersRoute = await import("../app/api/admin/users/route.js");
const { middleware } = await import("../src/middleware.js");
const { rawExec } = await import("@forgegent/db");
const { createAuth } = await import("../src/lib/auth.js");

// The route module uses the getAuth() singleton (rate limit max 10). The
// test drives several sign-ins in quick succession, which trips better-auth's
// stricter consecutive-attempt limiting — so test-side auth calls go through
// a second instance on the SAME db with a high limit.
const auth = getAuth();
const testAuth = createAuth(getDb(), [], { rateLimitMax: 10_000 });
const db = getDb();

const ADMIN_EMAIL = "r1admin@forgegent.local";
const TARGET_EMAIL = "r1target@forgegent.local";
const PASS = "password123";

async function signUp(email: string, password: string) {
  const res = await auth.api.signUpEmail({
    body: { email, password, name: email },
    asResponse: false,
  });
  return res.user.id;
}

async function signInCookie(email: string, password: string): Promise<string | null> {
  // better-auth has a BUILT-IN special rule for /sign-in/* (max 3 / 10s) that
  // overrides any configured max and counts in the SHARED kv counter — a
  // rapid-fire test would 429 itself. Reset the counter before each attempt.
  rawExec(db, "DELETE FROM kv_store WHERE key LIKE '%|/sign-in/email'");
  const res = await testAuth.handler(
    new Request("http://local/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),
  );
  if (!res.ok) return null;
  return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? null;
}

async function sessionOk(cookie: string | null): Promise<boolean> {
  if (!cookie) return false;
  // NB: better-auth's get-session answers 200 with `{session: null}` for
  // anonymous callers — validity is the parsed body, not res.ok.
  const res = await testAuth.handler(
    new Request("http://local/api/auth/get-session", { headers: { cookie } }),
  );
  const json = (await res.json().catch(() => null)) as { session?: unknown } | null;
  return Boolean(json?.session);
}

async function postUsers(cookie: string, body: unknown): Promise<Response> {
  return usersRoute.POST(
    new Request("http://local/api/admin/users", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const adminId = await signUp(ADMIN_EMAIL, PASS);
rawExec(db, "INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'role-admin')", adminId);
const targetId = await signUp(TARGET_EMAIL, PASS);
const adminCookie = await signInCookie(ADMIN_EMAIL, PASS);
const targetOldCookie = await signInCookie(TARGET_EMAIL, PASS);

afterAll(() => {
  try {
    rmSync(process.env.FORGEGENT_DATA_DIR!, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe("R1 task 1.3 — reset-password is atomic, revoking sessions and forcing a change", () => {
  it("reset swaps the credential without a lockout window", async () => {
    expect(await sessionOk(targetOldCookie)).toBe(true);
    const res = await postUsers(adminCookie, {
      action: "reset-password",
      userId: targetId,
      password: "new-temp-pass-123",
    });
    expect(res.status).toBe(200);

    // Old sessions are revoked immediately (D43).
    expect(await sessionOk(targetOldCookie)).toBe(false);
    // The temp password works right away — the account was never left
    // credential-less. (The old-password-rejection check runs LAST: a failed
    // sign-in trips better-auth's consecutive-attempt lockout, which would
    // 429 the sign-ins the later tests need.)
    const freshCookie = await signInCookie(TARGET_EMAIL, "new-temp-pass-123");
    expect(freshCookie).toBeTruthy();

    // Task 1.4: the forced change is enforced server-side by the guard.
    const guarded = await guardRequest(auth, db, freshCookie, "agent.use");
    expect(guarded.ok).toBe(false);
    if (!guarded.ok) expect(guarded.reason).toBe("password-change-required");

    // Clearing the flag restores normal guard semantics (roles apply again).
    rawExec(db, "UPDATE users SET must_change_password = 0 WHERE id = ?", targetId);
    const cleared = await guardRequest(auth, db, freshCookie, "agent.use");
    expect(cleared.ok).toBe(false); // no employee role
    if (!cleared.ok) expect(cleared.reason).toBe("forbidden");
  });
});

describe("R1 task 1.5 — disabled users are rejected at the auth layer", () => {
  it("disable revokes sessions and blocks new logins", async () => {
    const cookie = await signInCookie(TARGET_EMAIL, "new-temp-pass-123");
    expect(await sessionOk(cookie)).toBe(true);

    const res = await postUsers(adminCookie, {
      action: "set-status",
      userId: targetId,
      status: "disabled",
    });
    expect(res.status).toBe(200);

    // Existing session revoked.
    expect(await sessionOk(cookie)).toBe(false);
    // New login refused (databaseHooks — no session is issued at all).
    expect(await signInCookie(TARGET_EMAIL, "new-temp-pass-123")).toBeNull();
  });
});

describe("R1 task 1.6 — middleware enforces Origin on mutating API calls", () => {
  it("cross-origin POST is rejected, same-origin and GET pass", async () => {
    const { NextRequest } = await import("next/server");

    const cross = middleware(
      new NextRequest("http://local/api/tasks", {
        method: "POST",
        headers: { origin: "https://evil.example", host: "local" },
      }),
    );
    expect(cross.status).toBe(403);

    const same = middleware(
      new NextRequest("http://local/api/tasks", {
        method: "POST",
        headers: { origin: "http://local", host: "local" },
      }),
    );
    expect(same.status).toBeLessThan(400);

    const get = middleware(
      new NextRequest("http://local/api/tasks", {
        method: "GET",
        headers: { origin: "https://evil.example", host: "local" },
      }),
    );
    expect(get.status).toBeLessThan(400);
  });
});

describe("R1 task 1.3 (tail) — old password rejected after reset", () => {
  // Runs LAST on purpose: a failed sign-in arms better-auth's consecutive
  // attempt lockout (shared kv counter), so nothing may sign in after this.
  it("the pre-reset password no longer authenticates", async () => {
    expect(await signInCookie(TARGET_EMAIL, PASS)).toBeNull();
  });
});
