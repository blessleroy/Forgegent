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
import type { ForgegentDb } from "@forgegent/db";
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
import { validateDraftPayload, type DraftPayload } from "./payload.js";
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

/** Admin review (task 3.3): approve -> immutable release; reject -> editing
 *  with the review note preserved (D20). */
export async function reviewDraft(
  db: ForgegentDb,
  store: ReleaseStore,
  params: {
    draftId: string;
    adminId: string;
    decision: "approve" | "reject";
    note?: string;
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
  let snapshot;
  try {
    snapshot = store.writeSnapshot({
      releaseId,
      agentId: row.agentId,
      version: payload.version,
      payload,
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
  for (const toolId of payload.toolRefs ?? []) {
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

  const draft = toDraftWithSlug(row, slug, "approved");
  return {
    draft,
    releaseId,
    version: payload.version,
    checksum: snapshot.checksum,
  };
}

/** Delist (下架): blocks new tasks, keeps releases and running tasks. */
export async function delistAgent(
  db: ForgegentDb,
  params: { agentId: string },
): Promise<void> {
  const updated = await db
    .update(agents)
    .set({ listingState: "delisted" })
    .where(eq(agents.id, params.agentId))
    .returning({ id: agents.id });
  if (updated.length === 0) {
    throw new RegistryError("NOT_FOUND", "agent not found");
  }
}

/** Rollback = move the active release pointer only (D6). */
export async function rollbackToRelease(
  db: ForgegentDb,
  params: { agentId: string; releaseId: string },
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
  { id: string; slug: string; name: string; description: string; activeReleaseId: string | null }[]
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
  return visible.map(({ listingState: _listingState, ...rest }) => rest);
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
