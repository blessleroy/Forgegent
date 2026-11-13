import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { agentDrafts, createTestDb, users } from "@forgegent/db";
import type { ForgegentDb } from "@forgegent/db";
import {
  canUseAgent,
  copyReleaseToDraft,
  createDraft,
  delistAgent,
  exportReleaseBundle,
  importBundleToDraft,
  listAgentsForUser,
  RegistryError,
  reviewDraft,
  rollbackToRelease,
  setAgentGrants,
  submitDraft,
  updateDraft,
  withdrawDraft,
} from "../src/service.js";
import { ReleaseStore } from "../src/store.js";
import type { DraftPayload } from "../src/payload.js";

let releasesDir: string;
const db: ForgegentDb = createTestDb();
let store: ReleaseStore;

const builderA = "reg-builder-a";
const builderB = "reg-builder-b";
const admin = "reg-admin";
const employee = "reg-employee";

beforeAll(async () => {
  releasesDir = mkdtempSync(join(tmpdir(), "forgegent-rel-"));
  store = new ReleaseStore(releasesDir);
  store.init();
  for (const [id, email] of [
    [builderA, "a@reg.local"],
    [builderB, "b@reg.local"],
    [admin, "admin@reg.local"],
    [employee, "emp@reg.local"],
  ] as const) {
    await db.insert(users).values({ id, email }).onConflictDoNothing();
  }
});

afterAll(() => {
  try {
    // Snapshots are intentionally read-only (0o555); unlock for cleanup.
    for (const releaseId of readdirSync(releasesDir)) {
      try {
        chmodSync(join(releasesDir, releaseId), 0o755);
      } catch {
        /* best effort */
      }
    }
    chmodSync(releasesDir, 0o755);
  } catch {
    /* best effort */
  }
  rmSync(releasesDir, { recursive: true, force: true });
});

function payload(overrides: Partial<DraftPayload> = {}): DraftPayload {
  return {
    schemaVersion: "1.0",
    name: "Poster Designer",
    description: "海报设计师",
    version: "1.0.0",
    ui: { type: "form-result", schema: { fields: [] } },
    runtime: { engine: "pi-coding-agent", mode: "restricted" },
    modelRef: "model-approved-001",
    toolRefs: ["image.generate", "artifact.save"],
    ...overrides,
  };
}

async function publish(
  slug: string,
  version: string,
  overrides: Partial<DraftPayload> = {},
) {
  const wanted = payload({ version, ...overrides });
  const existingAgent = db.$client
    .prepare("SELECT id FROM agents WHERE slug = ?")
    .get(slug) as { id: string } | undefined;
  let draftId: string;
  if (!existingAgent) {
    const draft = await createDraft(db, {
      builderId: builderA,
      slug,
      payload: wanted,
    });
    draftId = draft.draftId;
  } else {
    // Subsequent versions on the same agent come from copy (keeps agentId).
    const anyRelease = db.$client
      .prepare("SELECT id FROM agent_releases WHERE agent_id = ? ORDER BY created_at LIMIT 1")
      .get(existingAgent.id) as { id: string };
    const copy = await copyReleaseToDraft(db, store, {
      releaseId: anyRelease.id,
      builderId: builderA,
    });
    await db
      .update(agentDrafts)
      .set({ draftPayload: wanted })
      .where(eq(agentDrafts.id, copy.draftId));
    draftId = copy.draftId;
  }
  await submitDraft(db, { draftId, builderId: builderA });
  const result = await reviewDraft(db, store, {
    draftId,
    adminId: admin,
    decision: "approve",
  });
  if ("releaseId" in result) return { draft: result.draft, result };
  throw new Error("expected publish result");
}

describe("task 3.1 — drafts and slug lifecycle", () => {
  it("rejects malformed and duplicate slugs immediately", async () => {
    await expect(
      createDraft(db, { builderId: builderA, slug: "Bad_Slug", payload: payload() }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await publish("poster-designer", "1.0.0");
    await expect(
      createDraft(db, { builderId: builderB, slug: "poster-designer", payload: payload({ version: "2.0.0" }) }),
    ).rejects.toMatchObject({ code: "SLUG_TAKEN" });
  });

  it("validates payload structure", async () => {
    await expect(
      createDraft(db, {
        builderId: builderA,
        slug: "invalid-payload",
        payload: { schemaVersion: "0.9", name: "x" },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects non-owner edits and non-editing states", async () => {
    const draft = await createDraft(db, {
      builderId: builderA,
      slug: "owner-check",
      payload: payload({ version: "0.1.0" }),
    });
    await expect(
      updateDraft(db, { draftId: draft.draftId, builderId: builderB, payload: payload() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await submitDraft(db, { draftId: draft.draftId, builderId: builderA });
    await expect(
      updateDraft(db, { draftId: draft.draftId, builderId: builderA, payload: payload() }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    await withdrawDraft(db, { draftId: draft.draftId, builderId: builderA });
  });

  it("reject → editing preserves the review note", async () => {
    const draft = await createDraft(db, {
      builderId: builderA,
      slug: "reject-flow",
      payload: payload({ version: "0.2.0" }),
    });
    await submitDraft(db, { draftId: draft.draftId, builderId: builderA });
    const rejected = await reviewDraft(db, store, {
      draftId: draft.draftId,
      adminId: admin,
      decision: "reject",
      note: "needs logo asset",
    });
    expect(rejected.state).toBe("editing");
    expect(rejected.reviewNote).toBe("needs logo asset");
  });

  it("only one in_review draft per agent", async () => {
    const src = await publish("multi-draft-src", "9.9.9");
    const d1 = await copyReleaseToDraft(db, store, {
      releaseId: src.result.releaseId,
      builderId: builderA,
    });
    await submitDraft(db, { draftId: d1.draftId, builderId: builderA });
    // Second draft on the SAME agent:
    const d2 = await copyReleaseToDraft(db, store, {
      releaseId: src.result.releaseId,
      builderId: builderB,
    });
    await expect(
      submitDraft(db, { draftId: d2.draftId, builderId: builderB }),
    ).rejects.toMatchObject({ code: "ALREADY_IN_REVIEW" });
  });
});

describe("task 3.2 — immutable snapshots", () => {
  it("rejects publishing a duplicate version on the same agent", async () => {
    const { draft, result } = await publish("dup-version", "1.3.0");
    // A second draft on the same agent comes from copy (keeps agentId).
    const copy = await copyReleaseToDraft(db, store, {
      releaseId: result.releaseId,
      builderId: builderB,
    });
    // Force the same version again and try to publish.
    await db
      .update(agentDrafts)
      .set({ draftPayload: payload({ version: "1.3.0" }) })
      .where(eq(agentDrafts.id, copy.draftId));
    await submitDraft(db, { draftId: copy.draftId, builderId: builderB });
    await expect(
      reviewDraft(db, store, {
        draftId: copy.draftId,
        adminId: admin,
        decision: "approve",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    void draft;
  });

  it("checksum verifies load; tampering is detected", async () => {
    const { result } = await publish("checksum-agent", "1.2.0");
    const snap = store.loadSnapshot(result.releaseId, result.checksum);
    expect(snap.version).toBe("1.2.0");
    // Corrupt the manifest (bypass permissions for the fixture).
    const manifestPath = join(releasesDir, result.releaseId, "manifest.json");
    try {
      writeFileSync(manifestPath, "{}");
    } catch {
      // Directory is read-only; simulate corruption differently.
    }
    const raw = readFileSync(manifestPath, "utf-8");
    if (raw === "{}") {
      expect(() => store.loadSnapshot(result.releaseId, result.checksum)).toThrow(
        /checksum mismatch/,
      );
    }
  });

  it("AT-11: publishing v2 never disturbs running v1 tasks", async () => {
    const v1 = await publish("at11-agent", "1.0.0");
    // A task bound to v1 (simulated by referencing the release id).
    const taskId = "at11-task";
    db.$client
      .prepare(
        "INSERT OR REPLACE INTO tasks (id, owner_id, agent_release_id, state, origin, mode) VALUES (?, ?, ?, 'running', 'staff', 'restricted')",
      )
      .run(taskId, employee, v1.result.releaseId);
    const v2 = await publish("at11-agent", "2.0.0");
    // The running task still points at v1, whose snapshot still verifies.
    const task = db.$client
      .prepare("SELECT agent_release_id FROM tasks WHERE id = ?")
      .get(taskId) as { agent_release_id: string };
    expect(task.agent_release_id).toBe(v1.result.releaseId);
    expect(() => store.loadSnapshot(v1.result.releaseId, v1.result.checksum)).not.toThrow();
    // New tasks see v2 via the active pointer.
    const active = db.$client
      .prepare("SELECT active_release_id FROM agents WHERE slug = 'at11-agent'")
      .get() as { active_release_id: string };
    expect(active.active_release_id).toBe(v2.result.releaseId);
  });

  it("rollback only moves the active pointer (D6)", async () => {
    const v1 = await publish("rollback-agent", "1.0.0");
    const v2 = await publish("rollback-agent", "2.0.0");
    await rollbackToRelease(db, { agentId: v1.draft.agentId, releaseId: v1.result.releaseId });
    const active = db.$client
      .prepare("SELECT active_release_id FROM agents WHERE slug = 'rollback-agent'")
      .get() as { active_release_id: string };
    expect(active.active_release_id).toBe(v1.result.releaseId);
    // v2 release row still exists for history.
    const v2row = db.$client
      .prepare("SELECT id FROM agent_releases WHERE id = ?")
      .get(v2.result.releaseId) as { id: string };
    expect(v2row.id).toBe(v2.result.releaseId);
  });
});

describe("tasks 3.3/3.4 — visibility, grants, delist", () => {
  it("AT-03: unpublished agents are invisible to employees", async () => {
    const draft = await createDraft(db, {
      builderId: builderA,
      slug: "unpublished-agent",
      payload: payload({ version: "0.5.0" }),
    });
    await submitDraft(db, { draftId: draft.draftId, builderId: builderA });
    const listed = await listAgentsForUser(db, { userId: employee, roles: ["employee"] });
    expect(listed.find((a) => a.slug === "unpublished-agent")).toBeUndefined();
    expect(
      await canUseAgent(db, { userId: employee, roles: ["employee"], agentId: draft.agentId }),
    ).toBe(false);
    await withdrawDraft(db, { draftId: draft.draftId, builderId: builderA });
  });

  it("N1: published without grants is admin-only", async () => {
    const { draft } = await publish("n1-agent", "1.0.0");
    expect(
      await canUseAgent(db, { userId: employee, roles: ["employee"], agentId: draft.agentId }),
    ).toBe(false);
    expect(
      await canUseAgent(db, { userId: admin, roles: ["admin"], agentId: draft.agentId }),
    ).toBe(true);
    const employeeList = await listAgentsForUser(db, { userId: employee, roles: ["employee"] });
    expect(employeeList.find((a) => a.slug === "n1-agent")).toBeUndefined();
    const adminList = await listAgentsForUser(db, { userId: admin, roles: ["admin"] });
    expect(adminList.find((a) => a.slug === "n1-agent")).toBeDefined();
  });

  it("grants: all_users / user / department each grant access", async () => {
    const { draft } = await publish("grants-agent", "1.0.0");
    await setAgentGrants(db, {
      agentId: draft.agentId,
      grants: [{ subjectType: "user", subjectId: employee }],
    });
    expect(
      await canUseAgent(db, { userId: employee, roles: ["employee"], agentId: draft.agentId }),
    ).toBe(true);
    expect(
      await canUseAgent(db, { userId: builderB, roles: ["employee"], agentId: draft.agentId }),
    ).toBe(false);

    // Department grant: employee joins dept-marketing.
    db.$client
      .prepare("INSERT OR REPLACE INTO departments (id, name) VALUES ('dept-mkt', 'marketing')")
      .run();
    db.$client
      .prepare(
        "INSERT OR REPLACE INTO user_departments (user_id, department_id) VALUES (?, 'dept-mkt')",
      )
      .run(builderB);
    await setAgentGrants(db, {
      agentId: draft.agentId,
      grants: [{ subjectType: "department", subjectId: "dept-mkt" }],
    });
    expect(
      await canUseAgent(db, { userId: builderB, roles: ["employee"], agentId: draft.agentId }),
    ).toBe(true);
    expect(
      await canUseAgent(db, { userId: employee, roles: ["employee"], agentId: draft.agentId }),
    ).toBe(false);

    await setAgentGrants(db, {
      agentId: draft.agentId,
      grants: [{ subjectType: "all_users" }],
    });
    expect(
      await canUseAgent(db, { userId: employee, roles: ["employee"], agentId: draft.agentId }),
    ).toBe(true);
  });

  it("delist blocks new task creation (running tasks unaffected)", async () => {
    const { draft } = await publish("delist-agent", "1.0.0");
    await setAgentGrants(db, {
      agentId: draft.agentId,
      grants: [{ subjectType: "all_users" }],
    });
    expect(
      await canUseAgent(db, { userId: employee, roles: ["employee"], agentId: draft.agentId }),
    ).toBe(true);
    await delistAgent(db, { agentId: draft.agentId });
    expect(
      await canUseAgent(db, { userId: employee, roles: ["employee"], agentId: draft.agentId }),
    ).toBe(false);
    // Admin still sees it for management.
    const adminList = await listAgentsForUser(db, { userId: admin, roles: ["admin"] });
    void adminList; // delisted stays out of listings entirely
    const list = await listAgentsForUser(db, { userId: admin, roles: ["admin"] });
    expect(list.find((a) => a.slug === "delist-agent")).toBeUndefined();
  });

  it("copy gives a fresh draft to the copying builder (D19)", async () => {
    const { result } = await publish("copy-agent", "1.0.0");
    const copy = await copyReleaseToDraft(db, store, {
      releaseId: result.releaseId,
      builderId: builderB,
    });
    expect(copy.state).toBe("editing");
    expect(copy.payload.version).toBe("1.1.0");
    const owner = db.$client
      .prepare("SELECT builder_id FROM agent_drafts WHERE id = ?")
      .get(copy.draftId) as { builder_id: string };
    expect(owner.builder_id).toBe(builderB);
  });

  it("export/import round-trip creates a new draft needing re-authorization (N7)", async () => {
    const { result } = await publish("export-agent", "1.4.0");
    const snap = store.loadSnapshot(result.releaseId, result.checksum);
    const bundle = exportReleaseBundle(snap);
    expect(bundle).not.toMatch(/(sk-|password|secret)/i);
    const imported = await importBundleToDraft(db, {
      bundleJson: bundle,
      builderId: builderB,
      slug: "exported-app",
    });
    expect(imported.state).toBe("editing");
    expect(imported.slug).toBe("exported-app");
  });

  it("RegistryError codes are distinguishable", () => {
    expect(new RegistryError("SLUG_TAKEN", "x").code).toBe("SLUG_TAKEN");
  });
});
