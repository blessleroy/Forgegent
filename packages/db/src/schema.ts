/**
 * Forgegent database schema (task 1.3).
 *
 * Covers PRD §9 minimal table set plus the decisions recorded in
 * openspec/le-spec/state.md: departments (N3), task_file_refs (D23),
 * studio_conversations (N4), tasks.origin (N4).
 */
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** JSON-valued column (drizzle sqlite: text with json mode). */
const jsonCol = (name: string) => text(name, { mode: "json" });

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
};

/** identity-access: users with status + force-change-password flag (D14). */
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    username: text("username"),
    /** Legacy column (unused — better-auth stores credentials in accounts). */
    passwordHash: text("password_hash"),
    /** active | disabled (D22: disable only, no delete). */
    status: text("status").notNull().default("active"),
    mustChangePassword: integer("must_change_password", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Better Auth required columns (0002_auth). */
    name: text("name").notNull().default(""),
    emailVerified: integer("email_verified", { mode: "boolean" })
      .notNull()
      .default(false),
    image: text("image"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    ...timestamps,
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)],
);

/** Better Auth session store. */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    token: text("token").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [uniqueIndex("sessions_token_uq").on(t.token)],
);

/** Better Auth account store (credential password lives here). */
export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", {
    mode: "timestamp_ms",
  }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", {
    mode: "timestamp_ms",
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/** Better Auth verification store. */
export const verifications = sqliteTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const roles = sqliteTable(
  "roles",
  {
    id: text("id").primaryKey(),
    /** admin | builder | employee (shared.Role). */
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("roles_name_uq").on(t.name)],
);

export const userRoles = sqliteTable(
  "user_roles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

/** N3: departments administered manually by admins. */
export const departments = sqliteTable(
  "departments",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("departments_name_uq").on(t.name)],
);

export const userDepartments = sqliteTable(
  "user_departments",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    departmentId: text("department_id")
      .notNull()
      .references(() => departments.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.departmentId] })],
);

/** agent-registry: agents row created with the first draft (D20). */
export const agents = sqliteTable(
  "agents",
  {
    id: text("id").primaryKey(),
    /** Globally unique, validated at draft creation (D20). */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    icon: text("icon"),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    activeReleaseId: text("active_release_id"),
    /** listed | delisted (下架). */
    listingState: text("listing_state").notNull().default("listed"),
    categoryId: text("category_id"),
    ...timestamps,
  },
  (t) => [uniqueIndex("agents_slug_uq").on(t.slug)],
);

/** Hub categories managed by admins (N2). */
export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ...timestamps,
});

/** studio-building: draft state machine editing→in_review→rejected/approved (D20). */
export const agentDrafts = sqliteTable(
  "agent_drafts",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    builderId: text("builder_id")
      .notNull()
      .references(() => users.id),
    /** Full draft application payload (manifest/prompts/ui/skills/tests). */
    draftPayload: jsonCol("draft_payload").notNull(),
    state: text("state").notNull().default("editing"),
    reviewNote: text("review_note"),
    /** Submit-time automatic test gate result (N5). */
    autoTestResult: text("auto_test_result"),
    ...timestamps,
  },
  (t) => [
    index("agent_drafts_agent_idx").on(t.agentId),
    index("agent_drafts_builder_idx").on(t.builderId),
  ],
);

/** agent-registry: immutable release snapshots (checksum pinned). */
export const agentReleases = sqliteTable(
  "agent_releases",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    version: text("version").notNull(),
    immutablePackagePath: text("immutable_package_path").notNull(),
    checksum: text("checksum").notNull(),
    publishedBy: text("published_by")
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (t) => [uniqueIndex("agent_releases_version_uq").on(t.agentId, t.version)],
);

/** agent-registry: publish scope grants; absent grant = admin-only (N1). */
export const agentGrants = sqliteTable(
  "agent_grants",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    /** all_users | user | department. */
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id"),
    canUse: integer("can_use", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (t) => [index("agent_grants_agent_idx").on(t.agentId)],
);

/** skill-registry. */
export const skills = sqliteTable(
  "skills",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdBy: text("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [uniqueIndex("skills_slug_uq").on(t.slug)],
);

export const skillVersions = sqliteTable(
  "skill_versions",
  {
    id: text("id").primaryKey(),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id),
    version: text("version").notNull(),
    packagePath: text("package_path").notNull(),
    checksum: text("checksum").notNull(),
    /** published | revoked (D18: revoke blocks new bindings only). */
    status: text("status").notNull().default("published"),
    ...timestamps,
  },
  (t) => [uniqueIndex("skill_versions_uq").on(t.skillId, t.version)],
);

export const skillSubmissions = sqliteTable(
  "skill_submissions",
  {
    id: text("id").primaryKey(),
    submitterId: text("submitter_id")
      .notNull()
      .references(() => users.id),
    contentPath: text("content_path").notNull(),
    /** pending | approved | rejected. */
    reviewState: text("review_state").notNull().default("pending"),
    reviewerId: text("reviewer_id").references(() => users.id),
    reviewNote: text("review_note"),
    ...timestamps,
  },
  (t) => [index("skill_submissions_state_idx").on(t.reviewState)],
);

/** Admin grants skill binding rights to builders (skill-registry spec). */
export const skillBindings = sqliteTable(
  "skill_bindings",
  {
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id),
    builderId: text("builder_id")
      .notNull()
      .references(() => users.id),
    grantedBy: text("granted_by")
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.skillId, t.builderId] })],
);

/** resource-governance: model endpoints, shared docs, HTTP tools. */
export const resources = sqliteTable("resources", {
  id: text("id").primaryKey(),
  /** model_endpoint | shared_doc | http_tool. */
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  /** Server-side reference to secret store entry; never the secret itself. */
  configRef: text("config_ref"),
  config: jsonCol("config"),
  ...timestamps,
});

export const resourceGrants = sqliteTable(
  "resource_grants",
  {
    id: text("id").primaryKey(),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resources.id),
    /** all_users | user | department. */
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id"),
    /** read | read/write (default read-only, FR-05.5). */
    actions: text("actions").notNull().default("read"),
    ...timestamps,
  },
  (t) => [index("resource_grants_resource_idx").on(t.resourceId)],
);

/** task-execution. */
export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    agentReleaseId: text("agent_release_id")
      .notNull()
      .references(() => agentReleases.id),
    state: text("state").notNull().default("pending"),
    /** staff | test (N4: builder test runs stay out of employee lists). */
    origin: text("origin").notNull().default("staff"),
    mode: text("mode").notNull().default("restricted"),
    inputSummary: text("input_summary"),
    budget: jsonCol("budget"),
    leaseOwner: text("lease_owner"),
    leaseUntil: integer("lease_until", { mode: "timestamp_ms" }),
    sessionId: text("session_id"),
    ...timestamps,
  },
  (t) => [
    index("tasks_owner_idx").on(t.ownerId),
    index("tasks_state_idx").on(t.state),
    index("tasks_lease_idx").on(t.leaseUntil),
  ],
);

export const taskEvents = sqliteTable(
  "task_events",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    /** Monotonic per task; clients resume by last seen event id/seq. */
    seq: integer("seq").notNull(),
    eventType: text("event_type").notNull(),
    /** Filtered/sanitized payload only (FR-06.5). */
    safePayload: jsonCol("safe_payload"),
    ...timestamps,
  },
  (t) => [uniqueIndex("task_events_seq_uq").on(t.taskId, t.seq)],
);

/** personal-files. */
export const files = sqliteTable(
  "files",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    /** Producing task, if this file is a task artifact (D23). */
    taskId: text("task_id").references(() => tasks.id),
    storageKey: text("storage_key").notNull(),
    filename: text("filename").notNull(),
    size: integer("size").notNull(),
    mime: text("mime").notNull(),
    checksum: text("checksum").notNull(),
    /** Soft delete (D23): blocks hard removal while referenced. */
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (t) => [index("files_owner_idx").on(t.ownerId)],
);

/** D23: task input references to files (files.task_id covers output only). */
export const taskFileRefs = sqliteTable(
  "task_file_refs",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    fileId: text("file_id")
      .notNull()
      .references(() => files.id),
    /** input | output. */
    direction: text("direction").notNull(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.fileId, t.direction] })],
);

export const sessionRefs = sqliteTable(
  "session_refs",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    sessionPath: text("session_path").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("session_refs_task_idx").on(t.taskId)],
);

/** permission-enforcement: per-release tool policies. */
export const toolPolicies = sqliteTable(
  "tool_policies",
  {
    id: text("id").primaryKey(),
    releaseId: text("release_id")
      .notNull()
      .references(() => agentReleases.id),
    toolId: text("tool_id").notNull(),
    resourceScope: text("resource_scope"),
    allowedActions: text("allowed_actions").notNull(),
    ...timestamps,
  },
  (t) => [index("tool_policies_release_idx").on(t.releaseId)],
);

/** audit-observability: no secret values ever (FR-09.7). */
export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id").references(() => users.id),
    action: text("action").notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    /** allow | deny. */
    decision: text("decision").notNull(),
    reason: text("reason"),
    ...timestamps,
  },
  (t) => [index("audit_logs_actor_idx").on(t.actorId)],
);

export const usageRecords = sqliteTable(
  "usage_records",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    estimatedCost: integer("estimated_cost").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("usage_records_task_idx").on(t.taskId)],
);

/** N4: studio builder conversations persisted per draft. */
export const studioConversations = sqliteTable(
  "studio_conversations",
  {
    id: text("id").primaryKey(),
    draftId: text("draft_id")
      .notNull()
      .references(() => agentDrafts.id),
    builderId: text("builder_id")
      .notNull()
      .references(() => users.id),
    messages: jsonCol("messages").notNull(),
    ...timestamps,
  },
  (t) => [index("studio_conversations_draft_idx").on(t.draftId)],
);
