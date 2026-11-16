/**
 * Demo seed (task 4.8, D25): demo builder/employee accounts, a published
 * sample poster agent granted to everyone, and the model endpoint resource
 * (API key referenced via env, never stored in SQLite). Idempotent; runs in
 * the registry package to reuse publish flows without dependency cycles.
 */
import type { ForgegentDb } from "@forgegent/db";
import { rawExec, rawQuery } from "@forgegent/db";
import { createDraft, reviewDraft, setAgentGrants, submitDraft } from "./service.js";
import type { ReleaseStore } from "./store.js";

export interface SeedAccounts {
  adminEmail: string;
  adminPassword: string;
  builderEmail: string;
  builderPassword: string;
  employeeEmail: string;
  employeePassword: string;
}

export interface SeedOptions {
  accounts: SeedAccounts;
  modelEndpoint?: { baseUrl: string; model: string; apiKeyEnv: string };
}

type CreateUser = (
  email: string,
  password: string,
  name: string,
) => Promise<{ id: string }>;

async function ensureUser(
  db: ForgegentDb,
  email: string,
  name: string,
  role: "admin" | "builder" | "employee",
  password: string,
  createUser: CreateUser,
): Promise<string> {
  const existing = rawQuery<{ id: string }>(
    db,
    "SELECT id FROM users WHERE email = ?",
    email,
  )[0];
  if (existing) return existing.id;
  const user = await createUser(email, password, name);
  rawExec(
    db,
    "INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)",
    user.id,
    `role-${role}`,
  );
  return user.id;
}

export async function seedDemo(
  db: ForgegentDb,
  store: ReleaseStore,
  options: SeedOptions,
  createUser: CreateUser,
): Promise<{ seeded: boolean }> {
  // 1. Model endpoint resource (V1: single endpoint, key via env only).
  if (options.modelEndpoint) {
    const hasEndpoint = rawQuery<{ id: string }>(
      db,
      "SELECT id FROM resources WHERE kind = 'model_endpoint' LIMIT 1",
    )[0];
    if (!hasEndpoint) {
      rawExec(
        db,
        "INSERT INTO resources (id, kind, name, config) VALUES (?, 'model_endpoint', 'default', ?)",
        crypto.randomUUID(),
        JSON.stringify(options.modelEndpoint),
      );
    }
  }

  // 2. Demo accounts.
  const adminId = await ensureUser(
    db,
    options.accounts.adminEmail,
    "Admin",
    "admin",
    options.accounts.adminPassword,
    createUser,
  );
  const builderId = await ensureUser(
    db,
    options.accounts.builderEmail,
    "Demo Builder",
    "builder",
    options.accounts.builderPassword,
    createUser,
  );
  await ensureUser(
    db,
    options.accounts.employeeEmail,
    "Demo Employee",
    "employee",
    options.accounts.employeePassword,
    createUser,
  );

  // 3. Sample poster agent (published once, granted to everyone).
  const existingAgent = rawQuery<{ id: string }>(
    db,
    "SELECT id FROM agents WHERE slug = 'poster-designer'",
  )[0];
  if (!existingAgent) {
    const draft = await createDraft(db, {
      builderId,
      slug: "poster-designer",
      payload: {
        schemaVersion: "1.0",
        name: "海报设计师",
        description: "输入主题与风格，自动生成活动海报",
        version: "1.0.0",
        ui: {
          type: "form-result",
          schema: {
            fields: [
              { name: "theme", label: "主题", type: "text", required: true, placeholder: "如：秋季大促" },
              {
                name: "style",
                label: "风格",
                type: "select",
                required: true,
                options: ["简约", "喜庆", "商务"],
              },
              { name: "notes", label: "其他要求", type: "textarea" },
            ],
          },
        },
        runtime: { engine: "pi-coding-agent", mode: "restricted" },
        modelRef: "default",
        toolRefs: ["image.generate"],
        prompts: {
          system:
            "你是海报设计助手。根据用户输入的主题与风格调用 image.generate 工具生成海报。",
        },
      },
    });
    await submitDraft(db, { draftId: draft.draftId, builderId });
    const result = await reviewDraft(db, store, {
      draftId: draft.draftId,
      adminId,
      decision: "approve",
    });
    if ("releaseId" in result) {
      await setAgentGrants(db, {
        agentId: draft.agentId,
        grants: [{ subjectType: "all_users" }],
      });
    }
  }
  return { seeded: true };
}
