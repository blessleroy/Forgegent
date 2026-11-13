/**
 * Enterprise resource governance (tasks 8.4/8.5).
 *
 * - Shared doc resources with admin-granted ACLs; search filters by the
 *   requesting user's access FIRST, content is returned only afterwards
 *   (AT-10; agent grants never widen a user's own access).
 * - Declarative HTTP tool configs with JSON-Schema-ish validation; the
 *   credential resolves from server env at call time, egress is scoped to
 *   the release via tool_policies (D26).
 */
import { rawExec, rawQuery } from "@forgegent/db";
import type { ForgegentDb } from "@forgegent/db";

export interface HttpToolConfig {
  name: string;
  endpoint: string;
  method: "GET" | "POST";
  paramSchema: Record<string, unknown>;
  authType: "bearer-env" | "none";
  /** Env var holding the credential (server side only). */
  credentialEnv?: string;
}

export function validateHttpToolConfig(
  raw: unknown,
): { ok: true; config: HttpToolConfig } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const c = raw as Partial<HttpToolConfig>;
  if (!c?.name || !/^[a-z0-9][a-z0-9.-]*$/.test(c.name)) {
    errors.push("name must be kebab-case");
  }
  try {
    const url = new URL(c.endpoint ?? "");
    if (!/^https?:$/.test(url.protocol)) errors.push("endpoint must be http(s)");
  } catch {
    errors.push("endpoint must be a valid URL");
  }
  if (c.method !== "GET" && c.method !== "POST") errors.push("method must be GET or POST");
  const schema = c.paramSchema as { type?: string; properties?: unknown } | undefined;
  if (!schema || schema.type !== "object" || typeof schema.properties !== "object") {
    errors.push("paramSchema must be { type: 'object', properties: {...} }");
  }
  if (c.authType === "bearer-env" && !c.credentialEnv) {
    errors.push("bearer-env auth requires credentialEnv");
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, config: raw as HttpToolConfig };
}

/** Register a declarative HTTP tool resource (admin action, 8.5). */
export function declareHttpTool(db: ForgegentDb, rawConfig: unknown): HttpToolConfig {
  const check = validateHttpToolConfig(rawConfig);
  if (!check.ok) throw new Error(`invalid http tool config: ${check.errors.join("; ")}`);
  const host = new URL(check.config.endpoint).host;
  rawExec(
    db,
    "INSERT INTO resources (id, kind, name, config) VALUES (?, 'http_tool', ?, ?)",
    crypto.randomUUID(),
    check.config.name,
    JSON.stringify({ ...check.config, egressHost: host }),
  );
  return check.config;
}

/** Attach an http tool + its egress host to a release (D26 binding). */
export function bindHttpToolToRelease(
  db: ForgegentDb,
  params: { releaseId: string; toolName: string },
): void {
  const resource = rawQuery<{ config: string }>(
    db,
    "SELECT config FROM resources WHERE kind = 'http_tool' AND name = ?",
    params.toolName,
  )[0];
  if (!resource) throw new Error(`http tool ${params.toolName} not declared`);
  const config = JSON.parse(resource.config) as HttpToolConfig & { egressHost?: string };
  rawExec(
    db,
    "INSERT INTO tool_policies (id, release_id, tool_id, resource_scope, allowed_actions) VALUES (?, ?, ?, ?, 'invoke')",
    crypto.randomUUID(),
    params.releaseId,
    `http.${config.name}`,
    config.egressHost ?? new URL(config.endpoint).host,
  );
}

/** Release egress allowlist = the resource_scope of its http tool policies. */
export function egressAllowlistForRelease(db: ForgegentDb, releaseId: string): string[] {
  return rawQuery<{ resource_scope: string | null }>(
    db,
    "SELECT resource_scope FROM tool_policies WHERE release_id = ? AND tool_id LIKE 'http.%'",
    releaseId,
  )
    .map((r) => r.resource_scope)
    .filter((host): host is string => Boolean(host));
}

/* ---------------------------- shared docs (8.4) ---------------------------- */

export interface SharedDocEntry {
  id: string;
  title: string;
  content: string;
}

/** Register a shared doc resource with entries (admin action). */
export function addSharedDocResource(
  db: ForgegentDb,
  params: { name: string; entries: SharedDocEntry[]; grants: { subjectType: string; subjectId?: string }[] },
): { resourceId: string } {
  const resourceId = crypto.randomUUID();
  rawExec(
    db,
    "INSERT INTO resources (id, kind, name, config) VALUES (?, 'shared_doc', ?, ?)",
    resourceId,
    params.name,
    JSON.stringify({ entries: params.entries }),
  );
  for (const grant of params.grants) {
    rawExec(
      db,
      "INSERT INTO resource_grants (id, resource_id, subject_type, subject_id, actions) VALUES (?, ?, ?, ?, 'read')",
      crypto.randomUUID(),
      resourceId,
      grant.subjectType,
      grant.subjectId ?? null,
    );
  }
  return { resourceId };
}

async function userCanRead(
  db: ForgegentDb,
  userId: string,
  resourceId: string,
): Promise<boolean> {
  const grants = rawQuery<{ subject_type: string; subject_id: string | null }>(
    db,
    "SELECT subject_type, subject_id FROM resource_grants WHERE resource_id = ? AND actions LIKE '%read%'",
    resourceId,
  );
  if (grants.some((g) => g.subject_type === "all_users")) return true;
  if (grants.some((g) => g.subject_type === "user" && g.subject_id === userId)) {
    return true;
  }
  const userDepts = rawQuery<{ department_id: string }>(
    db,
    "SELECT department_id FROM user_departments WHERE user_id = ?",
    userId,
  );
  const deptIds = new Set(userDepts.map((d) => d.department_id));
  return grants.some(
    (g) => g.subject_type === "department" && g.subject_id !== null && deptIds.has(g.subject_id),
  );
}

export interface SearchHit {
  docName: string;
  entryId: string;
  title: string;
  snippet: string;
}

/**
 * ACL-first search (AT-10): resources the user cannot read never contribute
 * content; matched snippets are returned only after the filter.
 */
export async function searchSharedDocs(
  db: ForgegentDb,
  params: { userId: string; query: string },
): Promise<SearchHit[]> {
  const hits: SearchHit[] = [];
  const resources = rawQuery<{ id: string; name: string; config: string }>(
    db,
    "SELECT id, name, config FROM resources WHERE kind = 'shared_doc'",
  );
  const needle = params.query.toLowerCase();
  for (const resource of resources) {
    // Permission filter happens BEFORE any content is considered.
    if (!(await userCanRead(db, params.userId, resource.id))) continue;
    const config = JSON.parse(resource.config) as { entries: SharedDocEntry[] };
    for (const entry of config.entries) {
      if (
        entry.title.toLowerCase().includes(needle) ||
        entry.content.toLowerCase().includes(needle)
      ) {
        const at = entry.content.toLowerCase().indexOf(needle);
        hits.push({
          docName: resource.name,
          entryId: entry.id,
          title: entry.title,
          snippet: entry.content.slice(Math.max(0, at - 20), at + 60),
        });
      }
    }
  }
  return hits;
}
