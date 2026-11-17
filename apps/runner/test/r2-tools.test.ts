/**
 * R2 2.8/2.9/2.10 regressions at the executor layer:
 * - resources.search: ACL-first (unauthorized docs contribute nothing),
 *   untrusted-content framing, W10 explicit write refusal + audit trail.
 * - http.<name> tool: declarative schema, GET/POST mapping, server-side
 *   bearer credential, stable per-task idempotency key, truncated output.
 * - assembly: tools only appear when the release declares + tool_policies
 *   allow them (gateway whitelist stays authoritative).
 */
import { describe, expect, it } from "vitest";
import { createTestDb, rawExec, rawQuery, users } from "@forgegent/db";
import type { ForgegentDb } from "@forgegent/db";
import { addSharedDocResource } from "@forgegent/registry";
import {
  createResourcesSearchTool,
  createHttpTool,
  httpToolConfigsForRelease,
  UNTRUSTED_DOC_FRAMING,
} from "../src/executor.js";

const db: ForgegentDb = createTestDb();

async function seedUsers() {
  await db
    .insert(users)
    .values([
      { id: "r2-emp", email: "emp@r2.local" },
      { id: "r2-other", email: "other@r2.local" },
    ])
    .onConflictDoNothing();
}

describe("R2 task 2.8 — resources.search (AT-10 end-to-end)", () => {
  it("filters by the user's ACL before returning anything, with framing", async () => {
    await seedUsers();
    addSharedDocResource(db, {
      name: "公开手册",
      entries: [{ id: "e1", title: "品牌规范", content: "logo 用 forgegent 蓝" }],
      grants: [{ subjectType: "all_users" }],
    });
    addSharedDocResource(db, {
      name: "财务方案库",
      entries: [{ id: "e2", title: "机密预算", content: "预算 forgegent 数字" }],
      grants: [{ subjectType: "user", subjectId: "r2-other" }],
    });
    const tool = createResourcesSearchTool(db, { userId: "r2-emp", taskId: "t1" });
    const out = await tool.execute({ query: "forgegent" });
    expect(out).toContain(UNTRUSTED_DOC_FRAMING);
    expect(out).toContain("品牌规范");
    expect(out).not.toContain("机密预算");
    expect(out).not.toContain("财务方案库");
  });

  it("W10: write/delete operations are refused and audited", async () => {
    await seedUsers();
    const tool = createResourcesSearchTool(db, { userId: "r2-emp", taskId: "t2" });
    await expect(tool.execute({ query: "x", operation: "write" })).rejects.toThrow(
      /只读/,
    );
    const row = rawQuery<{ action: string; decision: string }>(
      db,
      "SELECT action, decision FROM audit_logs WHERE action LIKE '%resources.search:write%' ORDER BY created_at DESC LIMIT 1",
    )[0];
    expect(row).toBeDefined();
    expect(row!.decision).toBe("deny");
  });
});

describe("R2 task 2.9 — declarative http tool executor", () => {
  const cfg = {
    name: "crm-lookup",
    endpoint: "https://crm.local/api/customer",
    method: "GET" as const,
    paramSchema: {
      type: "object",
      properties: { customerId: { type: "string" } },
      required: ["customerId"],
    },
    authType: "bearer-env" as const,
    credentialEnv: "R2_HTTP_TOKEN",
  };

  it("GET maps params to the query string, injects the server-side credential and a stable idempotency key", async () => {
    process.env.R2_HTTP_TOKEN = "secret-token";
    try {
      const seen: { url: string; headers: Record<string, string> }[] = [];
      const tool = createHttpTool(cfg, "task-9", async (input, init) => {
        seen.push({
          url: String(input),
          headers: (init?.headers ?? {}) as Record<string, string>,
        });
        return new Response('{"name":"Acme"}', { status: 200 });
      });
      const out = await tool.execute({ customerId: "c-123" });
      expect(out).toContain("Acme");
      expect(seen[0]!.url).toContain("https://crm.local/api/customer?customerId=c-123");
      expect(seen[0]!.headers.authorization).toBe("Bearer secret-token");
      expect(seen[0]!.headers["idempotency-key"]).toBeTruthy();

      // Same task + args → same key (FR-06.8); different args → different.
      const tool2 = createHttpTool(cfg, "task-9", async () => new Response("{}"));
      const keyOf = async (args: Record<string, unknown>) => {
        let captured = "";
        const t = createHttpTool(cfg, "task-9", async (_i, init) => {
          captured = ((init?.headers ?? {}) as Record<string, string>)["idempotency-key"];
          return new Response("{}");
        });
        await t.execute(args);
        return captured;
      };
      void tool2;
      expect(await keyOf({ customerId: "c-123" })).toBe(seen[0]!.headers["idempotency-key"]);
      expect(await keyOf({ customerId: "c-999" })).not.toBe(seen[0]!.headers["idempotency-key"]);
    } finally {
      delete process.env.R2_HTTP_TOKEN;
    }
  });

  it("POST sends a JSON body and surfaces non-2xx as an error string", async () => {
    const postCfg = { ...cfg, method: "POST" as const };
    let body = "";
    const tool = createHttpTool(postCfg, "task-9b", async (_input, init) => {
      body = String(init?.body ?? "");
      return new Response("boom", { status: 503 });
    });
    const out = await tool.execute({ customerId: "c-1" });
    expect(body).toBe(JSON.stringify({ customerId: "c-1" }));
    expect(out).toContain("HTTP 503");
  });

  it("httpToolConfigsForRelease reads only policies bound to the release", () => {
    rawExec(
      db,
      "INSERT OR REPLACE INTO agents (id, slug, name, owner_id) VALUES ('r2-agent', 'r2-http-agent', 'R2', 'r2-emp')",
    );
    rawExec(
      db,
      "INSERT OR REPLACE INTO agent_releases (id, agent_id, version, immutable_package_path, checksum, published_by) VALUES ('rel-r2', 'r2-agent', '1.0.0', '/p', 'c', 'r2-emp')",
    );
    rawExec(
      db,
      "INSERT OR REPLACE INTO agent_releases (id, agent_id, version, immutable_package_path, checksum, published_by) VALUES ('rel-other', 'r2-agent', '1.1.0', '/p2', 'c2', 'r2-emp')",
    );
    rawExec(
      db,
      "INSERT OR REPLACE INTO resources (id, kind, name, config) VALUES ('r2-http', 'http_tool', 'crm-lookup', ?)",
      JSON.stringify(cfg),
    );
    rawExec(
      db,
      "INSERT INTO tool_policies (id, release_id, tool_id, resource_scope, allowed_actions) VALUES ('tp1', 'rel-r2', 'http.crm-lookup', 'crm.local', 'invoke')",
    );
    rawExec(
      db,
      "INSERT INTO tool_policies (id, release_id, tool_id, resource_scope, allowed_actions) VALUES ('tp2', 'rel-other', 'http.crm-lookup', 'crm.local', 'invoke')",
    );
    const configs = httpToolConfigsForRelease(db, "rel-r2");
    expect(configs.map((c) => c.name)).toEqual(["crm-lookup"]);
    expect(httpToolConfigsForRelease(db, "rel-none")).toEqual([]);
  });
});
