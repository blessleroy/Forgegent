/**
 * Agent registry service (agent-registry spec; tasks 3.1–3.4).
 *
 * Draft state machine (D20): editing -> in_review -> (reject -> editing |
 * approve -> immutable release). One in_review draft per agent. Publishing
 * writes an immutable snapshot and flips the active release pointer;
 * rollback only moves the pointer for new tasks (D6).
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { audit, rawQuery, type ForgegentDb } from "@forgegent/db";
import {
  agentDrafts,
  agentGrants,
  agentReleases,
  agents,
  departments,
  toolPolicies,
  userDepartments,
} from "@forgegent/db";
import type { Role } from "@forgegent/shared";
import { isScriptedPackage, publishSkillPackage, type SkillStore } from "@forgegent/skills";
import { validateDraftPayload, type DraftPayload } from "./payload.js";
import { declaredHttpToolIds } from "./resources.js";
import type { ReleaseStore } from "./store.js";

export type RegistryErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_STATE"
  | "SLUG_TAKEN"
  | "VALIDATION"
  | "ALREADY_IN_REVIEW"
  | "SNAPSHOT_ERROR";

export class RegistryError extends Error {
  constructor(
    public readonly code: RegistryErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface DraftRecord {
  draftId: string;
  agentId: string;
  slug: string;
  state: string;
  payload: DraftPayload;
  reviewNote: string | null;
}

function toDraft(row: {
  id: string;
  agentId: string;
  state: string;
  draftPayload: unknown;
  reviewNote: string | null;
}): DraftRecord {
  return {
    draftId: row.id,
    agentId: row.agentId,
    slug: "",
    state: row.state,
    payload: row.draftPayload as DraftPayload,
    reviewNote: row.reviewNote,
  };
}

async function slugFor(db: ForgegentDb, agentId: string): Promise<string> {
  const agent = await db
    .select({ slug: agents.slug })
    .from(agents)
    .where(eq(agents.id, agentId))
    .get();
  if (!agent) throw new RegistryError("NOT_FOUND", "agent not found");
  return agent.slug;
}

/**
 * D37 reference validation (remediation 2.3): references with REAL effect
 * must resolve to a real, authorized object at SAVE time; failures refuse
 * the save and carry usable lists so the builder (or the LLM retry) can fix
 * them — nothing is silently dropped.
 *
 * Strict (external effect / data access):
 * - skillRefs: published version AND a skill_bindings grant for this builder
 *   (embeddedSkills are different: generated drafts ride the agent review,
 *   D46 — no binding needed).
 * - toolRefs `http.*`: must be declared resources.
 * - resourceRefs: must exist as resource names.
 *
 * Advisory only (capability references per PRD §6 — no external effect):
 * - other toolRefs ids: format check; an id without an executor wired
 *   grants no capability (the gateway only passes declared tools).
 * - modelRef: opaque capability string; resolved at execution time with
 *   fallback to the default endpoint (an unresolvable ref is surfaced by
 *   the submit gate, not refused here).
 */
export function validateDraftReferences(
  db: ForgegentDb,
  builderId: string,
  payload: DraftPayload,
): void {
  const errors: string[] = [];

  const authorizedSkills = rawQuery<
    { slug: string; version: string; is_scripted: number }
  >(
    db,
    `SELECT s.slug, sv.version, sv.is_scripted FROM skill_versions sv
     JOIN skills s ON s.id = sv.skill_id
     JOIN skill_bindings b ON b.skill_id = s.id AND b.builder_id = ?
     WHERE sv.status = 'published'`,
    builderId,
  );
  const authorized = new Map(
    authorizedSkills.map((s) => [`${s.slug}@${s.version}`, s]),
  );
  for (const ref of payload.skillRefs ?? []) {
    const entry = authorized.get(`${ref.id}@${ref.version}`);
    if (!entry) {
      errors.push(
        `skill ${ref.id}@${ref.version} 未发布或该 Builder 无绑定授权`,
      );
    } else if (entry.is_scripted && payload.runtime.mode !== "sandboxed") {
      // FR-04.5: scripted skills must run sandboxed.
      errors.push(
        `skill ${ref.id}@${ref.version} 含脚本 — 该 Agent 必须以 sandboxed 模式运行（FR-04.5）`,
      );
    }
  }

  const httpIds = new Set(declaredHttpToolIds(db));
  for (const tool of payload.toolRefs ?? []) {
    if (!/^[a-z][a-z0-9.-]*$/.test(tool)) {
      errors.push(`tool "${tool}" 不是合法的工具 ID`);
    } else if (tool.startsWith("http.") && !httpIds.has(tool)) {
      errors.push(`http 工具 "${tool}" 未由管理员声明`);
    }
  }

  const resourceNames = new Set(
    rawQuery<{ name: string }>(db, "SELECT name FROM resources").map((r) => r.name),
  );
  for (const ref of payload.resourceRefs ?? []) {
    if (!resourceNames.has(ref)) {
      errors.push(`资源 "${ref}" 不存在`);
    }
  }

  if (errors.length > 0) {
    const hints: string[] = [];
    if (authorizedSkills.length > 0) {
      hints.push(`可绑定 Skill：${[...authorized.keys()].join("、")}`);
    }
    hints.push(
      `平台内置工具：image.generate、document.export、resources.search；已声明 http 工具：${httpIds.size ? [...httpIds].join("、") : "（无）"}`,
    );
    if (resourceNames.size > 0) {
      hints.push(`可用资源：${[...resourceNames].slice(0, 20).join("、")}`);
    }
    throw new RegistryError(
      "VALIDATION",
      `${errors.join("；")}。${hints.join("。")}`,
    );
  }
}

/** Task 3.1: create a draft; the agents row is created with the first draft
 *  and slug uniqueness is checked immediately (D20). */
export async function createDraft(
  db: ForgegentDb,
  params: {
    builderId: string;
    slug: string;
    payload: unknown;
  },
): Promise<DraftRecord> {
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(params.slug)) {
    throw new RegistryError(
      "VALIDATION",
      "slug must be lowercase kebab-case (2-63 chars)",
    );
  }
  const check = validateDraftPayload(params.payload);
  if (!check.ok) {
    throw new RegistryError("VALIDATION", check.errors.join("; "));
  }
  // D37: references must resolve to real, authorized objects at save time.
  validateDraftReferences(db, params.builderId, check.value);
  const existing = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.slug, params.slug))
    .get();
  if (existing) {
    throw new RegistryError("SLUG_TAKEN", `slug "${params.slug}" already exists`);
  }
  const agentId = randomUUID();
  await db.insert(agents).values({
    id: agentId,
    slug: params.slug,
    name: check.value.name,
    description: check.value.description,
    ownerId: params.builderId,
  });
  const draftId = randomUUID();
  await db.insert(agentDrafts).values({
    id: draftId,
    agentId,
    builderId: params.builderId,
    draftPayload: check.value,
    state: "editing",
  });
  return {
    draftId,
    agentId,
    slug: params.slug,
    state: "editing",
    payload: check.value,
    reviewNote: null,
  };
}

async function requireDraft(
  db: ForgegentDb,
  draftId: string,
): Promise<{ row: typeof agentDrafts.$inferSelect; slug: string }> {
  const row = await db
    .select()
    .from(agentDrafts)
    .where(eq(agentDrafts.id, draftId))
    .get();
  if (!row) throw new RegistryError("NOT_FOUND", "draft not found");
  return { row, slug: await slugFor(db, row.agentId) };
}

/** Draft edits are owner-only (D19) and only in editing state. */
export async function updateDraft(
  db: ForgegentDb,
  params: { draftId: string; builderId: string; payload: unknown },
): Promise<DraftRecord> {
  const { row, slug } = await requireDraft(db, params.draftId);
  if (row.builderId !== params.builderId) {
    throw new RegistryError("FORBIDDEN", "only the draft owner may edit");
  }
  if (row.state !== "editing") {
    throw new RegistryError(
      "INVALID_STATE",
      `draft is ${row.state}; only editing drafts can be modified`,
    );
  }
  const check = validateDraftPayload(params.payload);
  if (!check.ok) {
    throw new RegistryError("VALIDATION", check.errors.join("; "));
  }
  // D37: reference validation applies to edits exactly like creation.
  validateDraftReferences(db, params.builderId, check.value);
  await db
    .update(agentDrafts)
    .set({ draftPayload: check.value })
    .where(eq(agentDrafts.id, params.draftId));
  return {
    draftId: row.id,
    agentId: row.agentId,
    slug,
    state: row.state,
    payload: check.value,
    reviewNote: row.reviewNote,
  };
}

/** editing -> in_review; single in_review per agent (D20). */
export async function submitDraft(
  db: ForgegentDb,
  params: { draftId: string; builderId: string },
): Promise<DraftRecord> {
  const { row, slug } = await requireDraft(db, params.draftId);
  if (row.builderId !== params.builderId) {
    throw new RegistryError("FORBIDDEN", "only the draft owner may submit");
  }
  if (row.state !== "editing") {
    throw new RegistryError(
      "INVALID_STATE",
      `draft is ${row.state}; only editing drafts can be submitted`,
    );
  }
  const inReview = await db
    .select({ id: agentDrafts.id })
    .from(agentDrafts)
    .where(
      and(
        eq(agentDrafts.agentId, row.agentId),
        eq(agentDrafts.state, "in_review"),
      ),
    )
    .get();
  if (inReview) {
    throw new RegistryError(
      "ALREADY_IN_REVIEW",
      "another draft of this agent is already in review",
    );
  }
  await db
    .update(agentDrafts)
    .set({ state: "in_review" })
    .where(eq(agentDrafts.id, params.draftId));
  return {
    draftId: row.id,
    agentId: row.agentId,
    slug,
    state: "in_review",
    payload: row.draftPayload as DraftPayload,
    reviewNote: row.reviewNote,
  };
}

/** in_review -> editing (withdraw before review completes). */
export async function withdrawDraft(
  db: ForgegentDb,
  params: { draftId: string; builderId: string },
): Promise<DraftRecord> {
  const { row, slug } = await requireDraft(db, params.draftId);
  if (row.builderId !== params.builderId) {
    throw new RegistryError("FORBIDDEN", "only the draft owner may withdraw");
  }
  if (row.state !== "in_review") {
    throw new RegistryError(
      "INVALID_STATE",
      `draft is ${row.state}; only in_review drafts can be withdrawn`,
    );
  }
  await db
    .update(agentDrafts)
    .set({ state: "editing" })
    .where(eq(agentDrafts.id, params.draftId));
  return toDraftWithSlug(row, slug, "editing");
}

function toDraftWithSlug(
  row: typeof agentDrafts.$inferSelect,
  slug: string,
  state: string,
): DraftRecord {
  return {
    draftId: row.id,
    agentId: row.agentId,
    slug,
    state,
    payload: row.draftPayload as DraftPayload,
    reviewNote: row.reviewNote,
  };
}

export interface PublishResult {
  draft: DraftRecord;
  releaseId: string;
  version: string;
  checksum: string;
}

/** Admin review (task 3.3 + remediation 2.4/D46): approve -> immutable
 *  release (embedded generated skills are 连带审核-published and pinned into
 *  skillRefs); reject -> editing with the review note preserved (D20). */
export async function reviewDraft(
  db: ForgegentDb,
  store: ReleaseStore,
  params: {
    draftId: string;
    adminId: string;
    decision: "approve" | "reject";
    note?: string;
    /** Required when the payload carries embeddedSkills (D46). */
    skillStore?: SkillStore;
  },
): Promise<PublishResult | DraftRecord> {
  const { row, slug } = await requireDraft(db, params.draftId);
  if (row.state !== "in_review") {
    throw new RegistryError(
      "INVALID_STATE",
      `draft is ${row.state}; only in_review drafts can be reviewed`,
    );
  }
  const payload = row.draftPayload as DraftPayload;

  if (params.decision === "reject") {
    await db
      .update(agentDrafts)
      .set({ state: "editing", reviewNote: params.note ?? null })
      .where(eq(agentDrafts.id, params.draftId));
    return {
      ...toDraftWithSlug(row, slug, "editing"),
      reviewNote: params.note ?? null,
    };
  }

  const releaseId = randomUUID();
  const existing = await db
    .select({ version: agentReleases.version })
    .from(agentReleases)
    .where(
      and(
        eq(agentReleases.agentId, row.agentId),
        eq(agentReleases.version, payload.version),
      ),
    )
    .get();
  if (existing) {
    throw new RegistryError(
      "VALIDATION",
      `version ${payload.version} already released for this agent`,
    );
  }

  // ---- D46 连带审核: embedded generated skills are published as part of
  // THIS approval (submitter=builder, reviewer=admin, hash-pinned) and the
  // payload's skillRefs are backfilled BEFORE the immutable snapshot, so the
  // release pins exactly what was reviewed.
  const skillRefs = [...(payload.skillRefs ?? [])];
  for (const emb of payload.embeddedSkills ?? []) {
    if (
      isScriptedPackage({ name: emb.id, markdown: emb.markdown }) &&
      payload.runtime.mode !== "sandboxed"
    ) {
      throw new RegistryError(
        "VALIDATION",
        `内嵌 Skill「${emb.id}」含脚本 — 该 Agent 必须以 sandboxed 模式运行（FR-04.5）`,
      );
    }
    if (!params.skillStore) {
      throw new RegistryError(
        "VALIDATION",
        "草稿包含内嵌 Skill，需要 skillStore 才能连带发布（D46）",
      );
    }
    const publishedSkill = publishSkillPackage(db, params.skillStore, {
      slug: emb.id,
      version: payload.version,
      pkg: { name: emb.name, markdown: emb.markdown },
      submitterId: row.builderId,
      reviewerId: params.adminId,
    });
    if (
      !skillRefs.some((r) => r.id === emb.id && r.version === payload.version)
    ) {
      skillRefs.push({
        id: emb.id,
        version: payload.version,
        sha256: publishedSkill.checksum,
      });
    }
  }
  const publishPayload: DraftPayload = { ...payload, skillRefs };

  let snapshot;
  try {
    snapshot = store.writeSnapshot({
      releaseId,
      agentId: row.agentId,
      version: payload.version,
      payload: publishPayload,
      publishedBy: params.adminId,
    });
  } catch (error) {
    throw new RegistryError("SNAPSHOT_ERROR", String((error as Error).message));
  }
  await db.insert(agentReleases).values({
    id: releaseId,
    agentId: row.agentId,
    version: payload.version,
    immutablePackagePath: snapshot.releaseId,
    checksum: snapshot.checksum,
    publishedBy: params.adminId,
  });
  // Tool whitelist lands in tool_policies — the runtime source the Tool
  // Gateway checks against (permission-enforcement spec, task 5.2).
  for (const toolId of publishPayload.toolRefs ?? []) {
    await db.insert(toolPolicies).values({
      id: randomUUID(),
      releaseId,
      toolId,
      resourceScope: null,
      allowedActions: "invoke",
    });
  }
  await db
    .update(agentDrafts)
    .set({ state: "approved" })
    .where(eq(agentDrafts.id, params.draftId));
  await db
    .update(agents)
    .set({
      activeReleaseId: releaseId,
      listingState: "listed",
      description: payload.description,
      name: payload.name,
    })
    .where(eq(agents.id, row.agentId));
  await audit(db, {
    actorId: params.adminId,
    action: "agent.release.publish",
    resourceType: "agent_release",
    resourceId: releaseId,
    decision: "allow",
    payload: { version: payload.version, agentId: row.agentId },
  });

  const draft = toDraftWithSlug(row, slug, "approved");
  return {
    draft,
    releaseId,
    version: payload.version,
    checksum: snapshot.checksum,
  };
}

export async function delistAgent(
  db: ForgegentDb,
  params: { agentId: string; adminId?: string },
): Promise<void> {
  const updated = await db
    .update(agents)
    .set({ listingState: "delisted" })
    .where(eq(agents.id, params.agentId))
    .returning({ id: agents.id });
  if (updated.length === 0) {
    throw new RegistryError("NOT_FOUND", "agent not found");
  }
  await audit(db, {
    actorId: params.adminId ?? null,
    action: "agent.delist",
    resourceType: "agent",
    resourceId: params.agentId,
    decision: "allow",
  });
}

/** Rollback = move the active release pointer only (D6). */
export async function rollbackToRelease(
  db: ForgegentDb,
  params: { agentId: string; releaseId: string; adminId?: string },
): Promise<void> {
  const release = await db
    .select()
    .from(agentReleases)
    .where(
      and(
        eq(agentReleases.id, params.releaseId),
        eq(agentReleases.agentId, params.agentId),
      ),
    )
    .get();
  if (!release) {
    throw new RegistryError("NOT_FOUND", "release not found for this agent");
  }
  await db
    .update(agents)
    .set({ activeReleaseId: params.releaseId })
    .where(eq(agents.id, params.agentId));
  await audit(db, {
    actorId: params.adminId ?? null,
    action: "agent.release.rollback",
    resourceType: "agent",
    resourceId: params.agentId,
    decision: "allow",
    payload: { releaseId: params.releaseId, version: release.version },
  });
}

export type GrantSubject =
  | { subjectType: "all_users" }
  | { subjectType: "user"; subjectId: string }
  | { subjectType: "department"; subjectId: string };

/** Task 3.4: replace the agent's publish-scope grants. */
export async function setAgentGrants(
  db: ForgegentDb,
  params: { agentId: string; grants: GrantSubject[] },
): Promise<void> {
  const agent = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.id, params.agentId))
    .get();
  if (!agent) throw new RegistryError("NOT_FOUND", "agent not found");
  await db.delete(agentGrants).where(eq(agentGrants.agentId, params.agentId));
  for (const grant of params.grants) {
    await db.insert(agentGrants).values({
      id: randomUUID(),
      agentId: params.agentId,
      subjectType: grant.subjectType,
      subjectId: "subjectId" in grant ? grant.subjectId : null,
      canUse: true,
    });
  }
}

/** Effective use permission: listed + active release + grant match (N1:
 *  absent grants = admin only). */
export async function canUseAgent(
  db: ForgegentDb,
  params: { userId: string; roles: Role[]; agentId: string },
): Promise<boolean> {
  const agent = await db
    .select({
      listingState: agents.listingState,
      activeReleaseId: agents.activeReleaseId,
    })
    .from(agents)
    .where(eq(agents.id, params.agentId))
    .get();
  if (!agent || agent.listingState !== "listed" || !agent.activeReleaseId) {
    return false;
  }
  if (params.roles.includes("admin")) return true;
  const grants = await db
    .select()
    .from(agentGrants)
    .where(eq(agentGrants.agentId, params.agentId));
  if (grants.some((g) => g.subjectType === "all_users" && g.canUse)) {
    return true;
  }
  if (grants.some((g) => g.subjectType === "user" && g.subjectId === params.userId && g.canUse)) {
    return true;
  }
  const userDepts = await db
    .select({ departmentId: userDepartments.departmentId })
    .from(userDepartments)
    .where(eq(userDepartments.userId, params.userId));
  const deptIds = new Set(userDepts.map((d) => d.departmentId));
  return grants.some(
    (g) =>
      g.subjectType === "department" &&
      g.subjectId !== null &&
      deptIds.has(g.subjectId) &&
      g.canUse,
  );
}

/** Hub listing for a user (AT-03: unauthorized agents invisible). */
export async function listAgentsForUser(
  db: ForgegentDb,
  params: { userId: string; roles: Role[] },
): Promise<
  {
    id: string;
    slug: string;
    name: string;
    description: string;
    activeReleaseId: string | null;
    /** Hub category (admin-assigned, N9); null → 未分类. */
    category: string | null;
  }[]
> {
  const rows = await db
    .select({
      id: agents.id,
      slug: agents.slug,
      name: agents.name,
      description: agents.description,
      activeReleaseId: agents.activeReleaseId,
      listingState: agents.listingState,
    })
    .from(agents);
  const visible: typeof rows = [];
  for (const row of rows) {
    if (row.listingState !== "listed" || !row.activeReleaseId) continue;
    if (params.roles.includes("admin")) {
      visible.push(row);
      continue;
    }
    if (await canUseAgent(db, { userId: params.userId, roles: params.roles, agentId: row.id })) {
      visible.push(row);
    }
  }
  const categoryNames = new Map(
    rawQuery<{ id: string; name: string }>(db, "SELECT id, name FROM categories").map(
      (c) => [c.id, c.name],
    ),
  );
  const categoryOf = (agentId: string): string | null => {
    const row = rawQuery<{ category_id: string | null }>(
      db,
      "SELECT category_id FROM agents WHERE id = ?",
      agentId,
    )[0];
    return row?.category_id ? categoryNames.get(row.category_id) ?? null : null;
  };
  return visible.map(({ listingState: _listingState, ...rest }) => ({
    ...rest,
    category: categoryOf(rest.id),
  }));
}

/** Copy any published version into a fresh draft owned by the copier (D19). */
export async function copyReleaseToDraft(
  db: ForgegentDb,
  store: ReleaseStore,
  params: { releaseId: string; builderId: string },
): Promise<DraftRecord> {
  const release = await db
    .select()
    .from(agentReleases)
    .where(eq(agentReleases.id, params.releaseId))
    .get();
  if (!release) throw new RegistryError("NOT_FOUND", "release not found");
  const snapshot = store.loadSnapshot(release.id, release.checksum);
  const agent = await db
    .select({ slug: agents.slug })
    .from(agents)
    .where(eq(agents.id, release.agentId))
    .get();
  if (!agent) throw new RegistryError("NOT_FOUND", "agent not found");
  const [major, minor] = snapshot.version.split(".").map((v) => Number(v));
  const draftId = randomUUID();
  const payload: DraftPayload = {
    ...snapshot.payload,
    version: `${major}.${(minor ?? 0) + 1}.0`,
  };
  await db.insert(agentDrafts).values({
    id: draftId,
    agentId: release.agentId,
    builderId: params.builderId,
    draftPayload: payload,
    state: "editing",
  });
  return {
    draftId,
    agentId: release.agentId,
    slug: agent.slug,
    state: "editing",
    payload,
    reviewNote: null,
  };
}

/**
 * Export bundle: single sanitized JSON document (capability refs only).
 * Sensitive-shaped fields and internal identity references are stripped
 * recursively before serialization (FR-02.4).
 */
export function sanitizeForExport(value: unknown, depth = 0): unknown {
  if (depth > 10) return "[depth-limit]";
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForExport(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (/apiKey|api_key|secret|password|credential|bearer|token/i.test(key)) {
        continue; // never export secret-shaped keys
      }
      out[key] = sanitizeForExport(item, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") {
    // Strip credential-shaped values and internal absolute identity paths.
    return value
      .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
      .replace(/^\/(home|Users)\/[^\s"']+/g, "[internal-path]");
  }
  return value;
}

export function exportReleaseBundle(
  snapshot: { releaseId: string; version: string; payload: DraftPayload },
): string {
  return JSON.stringify(
    {
      schemaVersion: "1.0",
      bundle: "forgegent-app",
      sourceRelease: { version: snapshot.version },
      payload: sanitizeForExport(snapshot.payload),
    },
    null,
    2,
  );
}

/** Import creates a brand-new draft (status editing); production requires
 *  re-authorization and review (N7 / FR-02.4). */
export async function importBundleToDraft(
  db: ForgegentDb,
  params: { bundleJson: string; builderId: string; slug: string },
): Promise<DraftRecord> {
  let parsed: { payload?: unknown };
  try {
    parsed = JSON.parse(params.bundleJson) as { payload?: unknown };
  } catch {
    throw new RegistryError("VALIDATION", "bundle is not valid JSON");
  }
  return createDraft(db, {
    builderId: params.builderId,
    slug: params.slug,
    payload: parsed.payload,
  });
}

export { departments };
