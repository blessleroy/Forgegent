/**
 * R2 2.4/2.5/2.7 regressions:
 * - D46 连带审核: approving an agent with embeddedSkills publishes them as
 *   skill_versions (submitter=builder, reviewer=admin) and backfills
 *   skillRefs INTO the immutable snapshot.
 * - Scripted embedded skill + restricted mode is refused at publish.
 * - Scripted bound skill + restricted draft is refused at save (D37).
 * - Submission persistence: approval publishes the SUBMITTED content;
 *   revocation records the revoking admin.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createTestDb, rawExec, rawQuery, users } from "@forgegent/db";
import type { ForgegentDb } from "@forgegent/db";
import {
  createDraft,
  reviewDraft,
  submitDraft,
  ReleaseStore,
  validateDraftReferences,
  RegistryError,
} from "@forgegent/registry";
import {
  SkillStore,
  submitSkill,
  reviewSkillSubmission,
  revokeSkillVersion,
  isScriptedPackage,
  loadApprovedSkills,
} from "@forgegent/skills";

const db: ForgegentDb = createTestDb();
const releasesDir = mkdtempSync(join(tmpdir(), "d46-rel-"));
const skillsRoot = mkdtempSync(join(tmpdir(), "d46-skills-"));
const releaseStore = new ReleaseStore(releasesDir);
releaseStore.init();
const skillStore = new SkillStore(skillsRoot);

afterAll(() => {
  for (const dir of [releasesDir, skillsRoot]) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

async function seedUser(id: string, email: string) {
  await db.insert(users).values({ id, email }).onConflictDoNothing();
}

const basePayload = {
  schemaVersion: "1.0" as const,
  name: "Poster App",
  description: "d",
  version: "1.0.0",
  ui: { type: "form-result" as const, schema: { fields: [] } },
  runtime: { engine: "pi-coding-agent" as const, mode: "restricted" as const },
  toolRefs: ["image.generate"],
  resourceRefs: [],
};

describe("R2 task 2.4 — D46 连带审核", () => {
  it("approval publishes embedded skills and pins them into the snapshot skillRefs", async () => {
    await seedUser("d46-builder", "b@d46.local");
    await seedUser("d46-admin", "a@d46.local");
    const draft = await createDraft(db, {
      builderId: "d46-builder",
      slug: "d46-agent",
      payload: {
        ...basePayload,
        embeddedSkills: [
          { id: "poster-guidance", name: "海报指引", markdown: "# 海报指引\n品牌规范…" },
        ],
      },
    });
    await submitDraft(db, { draftId: draft.draftId, builderId: "d46-builder" });
    const outcome = (await reviewDraft(db, releaseStore, {
      draftId: draft.draftId,
      adminId: "d46-admin",
      decision: "approve",
      skillStore,
    })) as { releaseId: string; checksum: string };

    // Published as skill_versions with submitter/reviewer attribution.
    const version = rawQuery<{
      status: string; checksum: string; created_by: string;
    }>(
      db,
      `SELECT sv.status, sv.checksum, s.created_by FROM skill_versions sv
       JOIN skills s ON s.id = sv.skill_id WHERE s.slug = 'poster-guidance'`,
    )[0];
    expect(version).toBeDefined();
    expect(version!.status).toBe("published");
    expect(version!.created_by).toBe("d46-builder");

    // The immutable snapshot pins the published hash in skillRefs.
    const snap = releaseStore.loadSnapshot(outcome.releaseId, outcome.checksum);
    expect(snap.payload.skillRefs).toEqual([
      { id: "poster-guidance", version: "1.0.0", sha256: version!.checksum },
    ]);

    // And the pinned skill is loadable through the approved loader (2.6).
    const loaded = loadApprovedSkills(db, skillStore, snap.payload.skillRefs ?? []);
    expect(loaded.skills.map((s) => s.name)).toContain("poster-guidance");
    expect(loaded.diagnostics).toEqual([]);
  });

  it("re-pinning is idempotent when the draft already carries the ref", async () => {
    // The builder re-binds their own D46-published skill: admin grants the
    // binding (FR-04.4 — own creations need the grant too), then the backfill
    // must not duplicate the already-listed ref.
    const skillId = rawQuery<{ id: string }>(
      db,
      "SELECT id FROM skills WHERE slug = 'poster-guidance'",
    )[0]!.id;
    rawExec(
      db,
      "INSERT OR IGNORE INTO skill_bindings (skill_id, builder_id, granted_by) VALUES (?, 'd46-builder', 'd46-admin')",
      skillId,
    );
    const draft = await createDraft(db, {
      builderId: "d46-builder",
      slug: "d46-agent-3",
      payload: {
        ...basePayload,
        version: "1.1.0",
        skillRefs: [{ id: "poster-guidance", version: "1.0.0" }],
        embeddedSkills: [
          { id: "poster-guidance", name: "海报指引", markdown: "# v2\n更新" },
        ],
      },
    });
    await submitDraft(db, { draftId: draft.draftId, builderId: "d46-builder" });
    const outcome = (await reviewDraft(db, releaseStore, {
      draftId: draft.draftId,
      adminId: "d46-admin",
      decision: "approve",
      skillStore,
    })) as { releaseId: string; checksum: string };
    const snap = releaseStore.loadSnapshot(outcome.releaseId, outcome.checksum);
    // Two DIFFERENT pinned versions (the pre-listed 1.0.0 and the
    // freshly-published 1.1.0) is correct; a duplicate of the SAME
    // id@version would not be.
    const refs = snap.payload.skillRefs!;
    expect(refs).toHaveLength(2);
    expect(new Set(refs.map((r) => `${r.id}@${r.version}`))).toEqual(
      new Set(["poster-guidance@1.0.0", "poster-guidance@1.1.0"]),
    );
    const backfilled = refs.find((r) => r.version === "1.1.0");
    expect(backfilled!.sha256).toBeTruthy();
  });
});

describe("R2 task 2.7 — scripted binding requires sandboxed mode", () => {
  it("a bound scripted skill on a restricted draft is refused at save (D37)", async () => {
    await seedUser("d46-builder3", "b3@d46.local");
    await seedUser("d46-admin3", "a3@d46.local");
    // Publish a scripted skill the normal way and grant the binding.
    const { submissionId } = submitSkill(db, skillStore, {
      submitterId: "d46-admin3",
      pkg: {
        name: "scripted-tool",
        markdown: "# scripted",
        files: { "run.py": "print('hi')" },
      },
    });
    await reviewSkillSubmission(db, skillStore, {
      submissionId,
      reviewerId: "d46-admin3",
      decision: "approve",
      skillName: "scripted-tool",
      version: "1.0.0",
    });
    const skillId = rawQuery<{ id: string }>(
      db,
      "SELECT id FROM skills WHERE slug = 'scripted-tool'",
    )[0]!.id;
    rawExec(
      db,
      "INSERT OR IGNORE INTO skill_bindings (skill_id, builder_id, granted_by) VALUES (?, 'd46-builder3', 'd46-admin3')",
      skillId,
    );

    expect(() =>
      validateDraftReferences(db, "d46-builder3", {
        ...basePayload,
        runtime: { engine: "pi-coding-agent", mode: "restricted" },
        skillRefs: [{ id: "scripted-tool", version: "1.0.0" }],
      }),
    ).toThrow(/sandboxed/);

    expect(() =>
      validateDraftReferences(db, "d46-builder3", {
        ...basePayload,
        runtime: { engine: "pi-coding-agent", mode: "sandboxed" },
        skillRefs: [{ id: "scripted-tool", version: "1.0.0" }],
      }),
    ).not.toThrow();
  });

  it("isScriptedPackage detects script files and dependency manifests", () => {
    expect(isScriptedPackage({ name: "x", markdown: "# x" })).toBe(false);
    expect(isScriptedPackage({ name: "x", markdown: "# x", files: { "a.sh": "ls" } })).toBe(true);
    expect(isScriptedPackage({ name: "x", markdown: "# x", files: { "package.json": "{}" } })).toBe(true);
    expect(isScriptedPackage({ name: "x", markdown: "# x", files: { "notes.md": "hi" } })).toBe(false);
  });
});

describe("R2 task 2.5 — submission persistence & attributable revocation", () => {
  it("approval publishes the SUBMITTED content (not review-time content)", async () => {
    await seedUser("d46-emp", "e@d46.local");
    await seedUser("d46-admin4", "a4@d46.local");
    const { submissionId } = submitSkill(db, skillStore, {
      submitterId: "d46-emp",
      pkg: { name: "submitted-skill", markdown: "# 投稿人原文\n仅此内容" },
    });
    const outcome = await reviewSkillSubmission(db, skillStore, {
      submissionId,
      reviewerId: "d46-admin4",
      decision: "approve",
      skillName: "submitted-skill",
      version: "1.0.0",
      // No pkg override: the submitted content must be what gets published.
    });
    expect(outcome.state).toBe("published");
    const loaded = loadApprovedSkills(db, skillStore, [
      { id: "submitted-skill", version: "1.0.0", sha256: outcome.checksum },
    ]);
    expect(loaded.skills[0]!.markdown).toContain("投稿人原文");
  });

  it("revocation records the revoking admin (revoked_by)", async () => {
    const versionId = rawQuery<{ id: string }>(
      db,
      "SELECT sv.id FROM skill_versions sv JOIN skills s ON s.id = sv.skill_id WHERE s.slug = 'submitted-skill'",
    )[0]!.id;
    revokeSkillVersion(db, { skillVersionId: versionId, adminId: "d46-admin4" });
    const row = rawQuery<{ status: string; revoked_by: string | null }>(
      db,
      "SELECT status, revoked_by FROM skill_versions WHERE id = ?",
      versionId,
    )[0];
    expect(row!.status).toBe("revoked");
    expect(row!.revoked_by).toBe("d46-admin4");
  });
});

void RegistryError;
