/**
 * Better Auth instance (task 1.4, identity-access spec).
 *
 * - Credential (email+password) auth backed by our SQLite users/accounts via
 *   the drizzle adapter; password hashing/scrypt and session cookies are
 *   handled by better-auth with the hardened cookie options below.
 * - Built-in rate limiting covers brute-force attempts.
 * - Role checks stay in our user_roles table; rolesForUser() is the
 *   server-side source of truth, never the client.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { randomUUID } from "node:crypto";
import { accounts, sessions, users, verifications } from "@forgegent/db";
import type { ForgegentDb } from "@forgegent/db";

/** SQLite-backed secondary storage: sessions + rate limits survive restarts. */
function sqliteStorage(sqlite: {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...p: unknown[]): unknown;
    run(...p: unknown[]): unknown;
  };
}) {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS kv_store (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at INTEGER
  )`);
  const alive = (key: string): { value: string } | null => {
    const row = sqlite
      .prepare("SELECT value, expires_at FROM kv_store WHERE key = ?")
      .get(key) as { value: string; expires_at: number | null } | undefined;
    if (!row) return null;
    if (row.expires_at !== null && row.expires_at < Date.now()) {
      sqlite.prepare("DELETE FROM kv_store WHERE key = ?").run(key);
      return null;
    }
    return { value: row.value };
  };
  return {
    get: async (key: string) => alive(key)?.value ?? null,
    set: async (key: string, value: string, ttlSeconds?: number) => {
      const expiresAt =
        ttlSeconds !== undefined ? Date.now() + ttlSeconds * 1000 : null;
      sqlite
        .prepare(
          "INSERT OR REPLACE INTO kv_store (key, value, expires_at) VALUES (?, ?, ?)",
        )
        .run(key, value, expiresAt);
    },
    delete: async (key: string) => {
      sqlite.prepare("DELETE FROM kv_store WHERE key = ?").run(key);
    },
    getAndDelete: async (key: string) => {
      const hit = alive(key);
      if (!hit) return null;
      sqlite.prepare("DELETE FROM kv_store WHERE key = ?").run(key);
      return hit.value;
    },
    increment: async (key: string, ttlSeconds: number) => {
      const hit = alive(key);
      if (!hit) {
        sqlite
          .prepare(
            "INSERT OR REPLACE INTO kv_store (key, value, expires_at) VALUES (?, '1', ?)",
          )
          .run(key, Date.now() + ttlSeconds * 1000);
        return 1;
      }
      const next = Number(hit.value) + 1;
      sqlite
        .prepare("UPDATE kv_store SET value = ? WHERE key = ?")
        .run(String(next), key);
      return next;
    },
  };
}

type SqliteClient = Parameters<typeof sqliteStorage>[0];

export function createAuth(db: ForgegentDb, trustedOrigins: string[] = []) {
  const sqlite = (db as unknown as { $client: SqliteClient }).$client;
  return betterAuth({
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL ?? process.env.FORGEGENT_PUBLIC_URL,
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: { user: users, session: sessions, account: accounts, verification: verifications },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
    },
    advanced: {
      database: {
        generateId: () => randomUUID(),
      },
    },
    user: {
      additionalFields: {
        status: { type: "string", input: false },
        mustChangePassword: { type: "boolean", input: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24,
      freshAge: 0,
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 10,
      storage: "secondary-storage",
    },
    secondaryStorage: sqliteStorage(sqlite),
    trustedOrigins,
    cookies: {
      sessionToken: {
        options: {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
