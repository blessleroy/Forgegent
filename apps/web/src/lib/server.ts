/**
 * Web-process singletons: SQLite db + Better Auth instance + initial admin
 * bootstrap (tasks 1.4/1.6). Lazily initialised per process.
 */
import { join } from "node:path";
import { createDb } from "@forgegent/db";
import { ensureInitialAdmin } from "@forgegent/db";
import { createAuth, type Auth } from "./auth";

export function dataDir(): string {
  return process.env.FORGEGENT_DATA_DIR ?? join(process.cwd(), "data");
}

let dbPromise: ReturnType<typeof createDb> | null = null;
let authPromise: Auth | null = null;
let bootstrapped = false;

export function getDb() {
  if (!dbPromise) {
    dbPromise = createDb(join(dataDir(), "forgegent.sqlite"));
  }
  return dbPromise;
}

export function getAuth(): Auth {
  if (!authPromise) {
    authPromise = createAuth(getDb(), [
      process.env.FORGEGENT_PUBLIC_URL ?? "http://localhost:3000",
    ]);
  }
  return authPromise;
}

/** Create the first admin from env vars on an empty users table (D14). */
export async function ensureBootstrap(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;
  const auth = getAuth();
  const db = getDb();
  await ensureInitialAdmin(
    db,
    {
      adminEmail: process.env.FORGEGENT_ADMIN_EMAIL,
      adminPassword: process.env.FORGEGENT_ADMIN_PASSWORD,
    },
    async (email, password) => {
      const result = await auth.api.signUpEmail({
        body: { email, password, name: "Admin" },
        asResponse: false,
      });
      return { id: result.user.id };
    },
  );
}
