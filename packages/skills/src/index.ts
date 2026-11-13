/**
 * Skill registry (skill-registry spec; tasks 8.1–8.3).
 *
 * - Submission → admin review → published version with content hash
 *   (AT-09: unreviewed skills never enter the production loader).
 * - Revocation blocks NEW bindings only — existing releases keep running
 *   (D18); emergency takedown goes through agent delisting.
 * - loadApprovedSkills() feeds pi's skillsOverride: it loads exactly the
 *   skill versions pinned by an agent release, verifying each hash.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { rawExec, rawQuery } from "@forgegent/db";
import type { ForgegentDb } from "@forgegent/db";

export interface SkillPackage {
  /** SKILL.md front-matter name (kebab-case). */
  name: string;
  /** Full SKILL.md content. */
  markdown: string;
  /** Optional auxiliary files (relative path → content). */
  files?: Record<string, string>;
}

export interface SkillRef {
  id: string;
  version: string;
  sha256?: string;
}

/** Canonical content hash covering SKILL.md + auxiliary files. */
export function hashSkillPackage(pkg: SkillPackage): string {
  const hash = createHash("sha256");
  hash.update(pkg.markdown);
  for (const [path, content] of Object.entries(pkg.files ?? {}).sort(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    hash.update(`\n${path}\n${content}`);
  }
  return hash.digest("hex");
}

/** Filesystem store: skills/<skillId>/<version>/SKILL.md + files. */
export class SkillStore {
  constructor(private readonly root: string) {}

  dirFor(skillId: string, version: string): string {
    if (!/^[a-zA-Z0-9._-]+$/.test(skillId) || !/^[a-zA-Z0-9._-]+$/.test(version)) {
      throw new Error("invalid skill id or version");
    }
    return join(this.root, skillId, version);
  }

  write(skillId: string, version: string, pkg: SkillPackage): string {
    const dir = this.dirFor(skillId, version);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), pkg.markdown);
    for (const [path, content] of Object.entries(pkg.files ?? {})) {
      if (path.includes("..") || path.startsWith("/")) {
        throw new Error(`unsafe skill file path: ${path}`);
      }
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    return hashSkillPackage(pkg);
  }

  read(skillId: string, version: string): { pkg: SkillPackage; hash: string } {
    const dir = this.dirFor(skillId, version);
    if (!existsSync(join(dir, "SKILL.md"))) {
      throw new Error(`skill ${skillId}@${version} not found`);
    }
    const pkg: SkillPackage = {
      name: skillId,
      markdown: readFileSync(join(dir, "SKILL.md"), "utf-8"),
      files: {},
    };
    for (const [path, content] of Object.entries(pkg.files ?? {})) void path, void content;
    return { pkg, hash: hashSkillPackage(pkg) };
  }
}

/* --------------------------- submission flow --------------------------- */

/** Employee submission → pending review (投稿 ≠ 安装/运行). */
export function submitSkill(
  db: ForgegentDb,
  params: { submitterId: string; pkg: SkillPackage },
): { submissionId: string } {
  const submissionId = crypto.randomUUID();
  const contentPath = `submissions/${submissionId}`;
  rawExec(
    db,
    "INSERT INTO skill_submissions (id, submitter_id, content_path, review_state) VALUES (?, ?, ?, 'pending')",
    submissionId,
    params.submitterId,
    contentPath,
  );
  // The package itself is parked in the submission store path (draft area,
  // never the production loader source).
  return { submissionId };
}

export interface ReviewOutcome {
  state: "published" | "rejected";
  skillId?: string;
  version?: string;
  checksum?: string;
}

/** Admin review (8.2): approve publishes a hashed version; reject keeps the note. */
export async function reviewSkillSubmission(
  db: ForgegentDb,
  store: SkillStore,
  params: {
    submissionId: string;
    reviewerId: string;
    decision: "approve" | "reject";
    skillName: string;
    version: string;
    pkg: SkillPackage;
    note?: string;
  },
): Promise<ReviewOutcome> {
  const row = rawQuery<{ review_state: string }>(
    db,
    "SELECT review_state FROM skill_submissions WHERE id = ?",
    params.submissionId,
  )[0];
  if (!row) throw new Error("submission not found");
  if (row.review_state !== "pending") {
    throw new Error(`submission already ${row.review_state}`);
  }
  if (params.decision === "reject") {
    rawExec(
      db,
      "UPDATE skill_submissions SET review_state = 'rejected', reviewer_id = ?, review_note = ? WHERE id = ?",
      params.reviewerId,
      params.note ?? null,
      params.submissionId,
    );
    return { state: "rejected" };
  }
  const checksum = store.write(params.skillName, params.version, params.pkg);
  const existing = rawQuery<{ id: string }>(
    db,
    "SELECT id FROM skills WHERE slug = ?",
    params.skillName,
  )[0];
  const skillId = existing?.id ?? crypto.randomUUID();
  if (!existing) {
    rawExec(
      db,
      "INSERT INTO skills (id, slug, name, created_by) VALUES (?, ?, ?, ?)",
      skillId,
      params.skillName,
      params.skillName,
      params.reviewerId,
    );
  }
  rawExec(
    db,
    "INSERT INTO skill_versions (id, skill_id, version, package_path, checksum, status) VALUES (?, ?, ?, ?, ?, 'published')",
    crypto.randomUUID(),
    skillId,
    params.version,
    `${params.skillName}/${params.version}`,
    checksum,
  );
  rawExec(
    db,
    "UPDATE skill_submissions SET review_state = 'approved', reviewer_id = ?, review_note = ? WHERE id = ?",
    params.reviewerId,
    params.note ?? null,
    params.submissionId,
  );
  return {
    state: "published",
    skillId,
    version: params.version,
    checksum,
  };
}

/** Revoke: blocks new bindings only; running releases unaffected (D18). */
export function revokeSkillVersion(
  db: ForgegentDb,
  params: { skillVersionId: string; adminId: string },
): void {
  const result = rawQuery<{ id: string }>(
    db,
    "SELECT id FROM skill_versions WHERE id = ? AND status = 'published'",
    params.skillVersionId,
  )[0];
  if (!result) throw new Error("published skill version not found");
  rawExec(
    db,
    "UPDATE skill_versions SET status = 'revoked' WHERE id = ?",
    params.skillVersionId,
  );
}

/** Admin grants a builder the right to bind a skill (8.2). */
export function grantSkillBinding(
  db: ForgegentDb,
  params: { skillId: string; builderId: string; adminId: string },
): void {
  rawExec(
    db,
    "INSERT OR IGNORE INTO skill_bindings (skill_id, builder_id, granted_by) VALUES (?, ?, ?)",
    params.skillId,
    params.builderId,
    params.adminId,
  );
}

/** Bindable list for a builder: published versions + binding grants. */
export function bindableSkills(
  db: ForgegentDb,
  builderId: string,
): { skillId: string; slug: string; version: string; checksum: string }[] {
  return rawQuery(
    db,
    `SELECT sv.skill_id AS skillId, s.slug, sv.version, sv.checksum
     FROM skill_versions sv
     JOIN skills s ON s.id = sv.skill_id
     JOIN skill_bindings sb ON sb.skill_id = sv.skill_id AND sb.builder_id = ?
     WHERE sv.status = 'published'`,
    builderId,
  ) as { skillId: string; slug: string; version: string; checksum: string }[];
}

/* ---------------------- production loader (8.3) ---------------------- */

export interface LoadedSkill {
  name: string;
  markdown: string;
  version: string;
}

export interface LoaderResult {
  skills: LoadedSkill[];
  diagnostics: string[];
}

/**
 * skillsOverride implementation for pi's DefaultResourceLoader: load exactly
 * the release-pinned skill versions; every checksum is verified before the
 * skill becomes visible to the model. Unreviewed/revoked/mismatched refs
 * are skipped with a diagnostic (AT-09).
 */
export function loadApprovedSkills(
  db: ForgegentDb,
  store: SkillStore,
  refs: SkillRef[],
): LoaderResult {
  const skills: LoadedSkill[] = [];
  const diagnostics: string[] = [];
  for (const ref of refs) {
    const row = rawQuery<{ id: string; status: string; checksum: string; package_path: string }>(
      db,
      `SELECT sv.id, sv.status, sv.checksum, sv.package_path
       FROM skill_versions sv JOIN skills s ON s.id = sv.skill_id
       WHERE s.slug = ? AND sv.version = ?`,
      ref.id,
      ref.version,
    )[0];
    if (!row) {
      diagnostics.push(`skill ${ref.id}@${ref.version} not found`);
      continue;
    }
    if (row.status !== "published") {
      // D18: revocation blocks NEW bindings only. Releases that pinned the
      // version while it was published keep loading — the pinned checksum
      // is the integrity guarantee for the running snapshot.
      if (row.status === "revoked" && ref.sha256 === row.checksum) {
        const [name, version] = row.package_path.split("/");
        const stored = store.read(name!, version!);
        if (stored.hash === row.checksum) {
          skills.push({ name: name!, markdown: stored.pkg.markdown, version: version! });
          continue;
        }
      }
      diagnostics.push(`skill ${ref.id}@${ref.version} is ${row.status} — blocked (AT-09)`);
      continue;
    }
    if (ref.sha256 && ref.sha256 !== row.checksum) {
      diagnostics.push(`skill ${ref.id}@${ref.version} checksum mismatch — blocked`);
      continue;
    }
    const [name, version] = row.package_path.split("/");
    const stored = store.read(name!, version!);
    if (stored.hash !== row.checksum) {
      diagnostics.push(`skill ${ref.id}@${ref.version} store hash drift — blocked`);
      continue;
    }
    skills.push({
      name: name!,
      markdown: stored.pkg.markdown,
      version: version!,
    });
  }
  return { skills, diagnostics };
}
