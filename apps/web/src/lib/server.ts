/**
 * Web-process singletons: SQLite db + Better Auth instance + initial admin
 * bootstrap (tasks 1.4/1.6). Lazily initialised per process.
 */
import { join } from "node:path";
import { createDb, ensureInitialAdmin } from "@forgegent/db";
import { ReleaseStore, seedDemo } from "@forgegent/registry";
import { createAuth, type Auth } from "./auth";

export function dataDir(): string {
  return process.env.FORGEGENT_DATA_DIR ?? join(process.cwd(), "data");
}

/**
 * R4.10: upload policy from server-side configuration (admin-adjustable,
 * effective on restart): FORGEGENT_MAX_FILE_MB / FORGEGENT_USER_QUOTA_GB,
 * and optional FORGEGENT_FILE_EXT_ALLOW (comma list → strict allow-mode;
 * unset → default deny-list of executables/scripts).
 */
export function uploadPolicy(): {
  maxFileBytes: number;
  maxUserBytes: number;
  allowedExtensions?: string[];
} {
  const maxFileBytes = Math.max(1, Number(process.env.FORGEGENT_MAX_FILE_MB ?? 50)) * 1024 * 1024;
  const maxUserBytes =
    Math.max(0.1, Number(process.env.FORGEGENT_USER_QUOTA_GB ?? 2)) * 1024 * 1024 * 1024;
  const allow = (process.env.FORGEGENT_FILE_EXT_ALLOW ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return {
    maxFileBytes,
    maxUserBytes,
    ...(allow.length > 0 ? { allowedExtensions: allow } : {}),
  };
}

let dbPromise: ReturnType<typeof createDb> | null = null;
let authPromise: Auth | null = null;
let releaseStore: ReleaseStore | null = null;
let bootstrapped = false;

export function getDb() {
  if (!dbPromise) {
    dbPromise = createDb(join(dataDir(), "forgegent.sqlite"));
  }
  return dbPromise;
}

export function getReleaseStore(): ReleaseStore {
  if (!releaseStore) {
    releaseStore = new ReleaseStore(join(dataDir(), "releases"));
    releaseStore.init();
  }
  return releaseStore;
}

export function getAuth(): Auth {
  if (!authPromise) {
    authPromise = createAuth(getDb(), [
      process.env.FORGEGENT_PUBLIC_URL ?? "http://localhost:3000",
    ]);
  }
  return authPromise;
}

/** Create the first admin from env vars on an empty users table (D14),
 *  then optionally seed the demo workspace (D25, FORGEGENT_SEED_DEMO=1). */
export async function ensureBootstrap(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;
  const auth = getAuth();
  const db = getDb();
  const createUser = async (email: string, password: string, name?: string) => {
    const result = await auth.api.signUpEmail({
      body: { email, password, name: name ?? "User" },
      asResponse: false,
    });
    return { id: result.user.id };
  };
  await ensureInitialAdmin(
    db,
    {
      adminEmail: process.env.FORGEGENT_ADMIN_EMAIL,
      adminPassword: process.env.FORGEGENT_ADMIN_PASSWORD,
    },
    createUser,
  );
  if (process.env.FORGEGENT_SEED_DEMO === "1") {
    await seedDemo(db, getReleaseStore(), {
      accounts: {
        adminEmail: process.env.FORGEGENT_ADMIN_EMAIL ?? "admin@forgegent.local",
        adminPassword: process.env.FORGEGENT_ADMIN_PASSWORD ?? "init-pass-123",
        builderEmail: "builder@forgegent.local",
        builderPassword: "demo-builder-123",
        employeeEmail: "employee@forgegent.local",
        employeePassword: "demo-employee-123",
      },
      modelEndpoint: process.env.FORGEGENT_MODEL_BASE_URL
        ? {
            baseUrl: process.env.FORGEGENT_MODEL_BASE_URL,
            model: process.env.FORGEGENT_MODEL_NAME ?? "gpt-image-1",
            apiKeyEnv: "FORGEGENT_MODEL_API_KEY",
          }
        : undefined,
    }, createUser);
  }
}
