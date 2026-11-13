import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, rawQuery, users } from "@forgegent/db";
import type { ForgegentDb } from "@forgegent/db";
import {
  bindableSkills,
  grantSkillBinding,
  hashSkillPackage,
  loadApprovedSkills,
  reviewSkillSubmission,
  revokeSkillVersion,
  SkillStore,
  submitSkill,
} from "../src/index.js";

const db: ForgegentDb = createTestDb();
const skillsRoot = mkdtempSync(join(tmpdir(), "skills-"));
const store = new SkillStore(skillsRoot);

const submitter = "skill-employee";
const admin = "skill-admin";
const builder = "skill-builder";

beforeAll(async () => {
  for (const [id, email] of [
    [submitter, "emp@skill.local"],
    [admin, "admin@skill.local"],
    [builder, "builder@skill.local"],
  ] as const) {
    await db.insert(users).values({ id, email }).onConflictDoNothing();
  }
});

afterAll(() => rmSync(skillsRoot, { recursive: true, force: true }));

function pkg(name: string, extra = ""): { name: string; markdown: string } {
  return { name, markdown: `---\nname: ${name}\n---\n做该领域的专业任务。${extra}` };
}

describe("skill registry (tasks 8.1/8.2 — AT-09, D18)", () => {
  it("content hash covers SKILL.md + auxiliary files", () => {
    const a = hashSkillPackage(pkg("x"));
    const b = hashSkillPackage(pkg("x", "changed"));
    const c = hashSkillPackage({ ...pkg("x"), files: { "lib/notes.txt": "n" } });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it("AT-09 (front): unreviewed submissions never enter the production loader", async () => {
    const { submissionId } = submitSkill(db, {
      submitterId: submitter,
      pkg: pkg("pending-skill"),
    });
    void submissionId;
    const result = loadApprovedSkills(db, store, [
      { id: "pending-skill", version: "1.0.0" },
    ]);
    expect(result.skills).toEqual([]);
    expect(result.diagnostics[0]).toContain("not found");
  });

  it("AT-09 (back): approved submissions publish + become bindable", async () => {
    const { submissionId } = submitSkill(db, {
      submitterId: submitter,
      pkg: pkg("poster-design"),
    });
    const outcome = await reviewSkillSubmission(db, store, {
      submissionId,
      reviewerId: admin,
      decision: "approve",
      skillName: "poster-design",
      version: "1.0.0",
      pkg: pkg("poster-design"),
    });
    expect(outcome.state).toBe("published");

    grantSkillBinding(db, { skillId: outcome.skillId!, builderId: builder, adminId: admin });
    const bindable = bindableSkills(db, builder);
    expect(bindable.some((s) => s.slug === "poster-design" && s.version === "1.0.0")).toBe(true);

    // Loader resolves the published version with hash verification.
    const loaded = loadApprovedSkills(db, store, [
      { id: "poster-design", version: "1.0.0", sha256: outcome.checksum },
    ]);
    expect(loaded.diagnostics).toEqual([]);
    expect(loaded.skills[0]!.name).toBe("poster-design");

    // Without a binding grant, another builder cannot see it.
    expect(bindableSkills(db, submitter)).toEqual([]);
  });

  it("rejection keeps the reviewer note", async () => {
    const { submissionId } = submitSkill(db, {
      submitterId: submitter,
      pkg: pkg("bad-skill"),
    });
    const outcome = await reviewSkillSubmission(db, store, {
      submissionId,
      reviewerId: admin,
      decision: "reject",
      skillName: "bad-skill",
      version: "1.0.0",
      pkg: pkg("bad-skill"),
      note: "包含不安全脚本",
    });
    expect(outcome.state).toBe("rejected");
    const row = rawQuery<{ review_note: string; reviewer_id: string }>(
      db,
      "SELECT review_note, reviewer_id FROM skill_submissions WHERE id = ?",
      submissionId,
    )[0];
    expect(row.review_note).toBe("包含不安全脚本");
    expect(row.reviewer_id).toBe(admin);
  });

  it("D18: revocation blocks new bindings but existing releases keep loading", async () => {
    const { submissionId } = submitSkill(db, {
      submitterId: submitter,
      pkg: pkg("doc-format"),
    });
    const outcome = await reviewSkillSubmission(db, store, {
      submissionId,
      reviewerId: admin,
      decision: "approve",
      skillName: "doc-format",
      version: "1.0.0",
      pkg: pkg("doc-format"),
    });
    grantSkillBinding(db, { skillId: outcome.skillId!, builderId: builder, adminId: admin });

    // A release pins the version BEFORE revocation (published reference).
    const versionRow = rawQuery<{ id: string }>(
      db,
      "SELECT sv.id FROM skill_versions sv JOIN skills s ON s.id = sv.skill_id WHERE s.slug = 'doc-format' AND sv.version = '1.0.0'",
    )[0];
    revokeSkillVersion(db, { skillVersionId: versionRow.id, adminId: admin });

    // New binding list no longer offers it...
    expect(bindableSkills(db, builder).some((s) => s.slug === "doc-format")).toBe(false);
    // ...but the existing release's pinned ref still loads (D18: no kill-switch).
    const loaded = loadApprovedSkills(db, store, [
      { id: "doc-format", version: "1.0.0", sha256: outcome.checksum },
    ]);
    expect(loaded.skills).toHaveLength(1);
  });

  it("checksum mismatches are blocked (tamper protection)", async () => {
    const { submissionId } = submitSkill(db, {
      submitterId: submitter,
      pkg: pkg("tampered"),
    });
    const outcome = await reviewSkillSubmission(db, store, {
      submissionId,
      reviewerId: admin,
      decision: "approve",
      skillName: "tampered",
      version: "1.0.0",
      pkg: pkg("tampered"),
    });
    const loaded = loadApprovedSkills(db, store, [
      { id: "tampered", version: "1.0.0", sha256: "deadbeef".repeat(8) },
    ]);
    expect(loaded.skills).toEqual([]);
    expect(loaded.diagnostics[0]).toContain("checksum mismatch");
    void outcome;
  });
});
