import { describe, expect, it } from "vitest";
import { createTestDb, rawExec } from "@forgegent/db";
import type { ForgegentDb } from "@forgegent/db";
import {
  addSharedDocResource,
  bindHttpToolToRelease,
  declareHttpTool,
  egressAllowlistForRelease,
  searchSharedDocs,
  validateHttpToolConfig,
} from "../src/resources.js";

const db: ForgegentDb = createTestDb();

describe("HTTP tool configs (task 8.5 — D26)", () => {
  it("validates declarative configs strictly", () => {
    expect(
      validateHttpToolConfig({
        name: "crm.lookup",
        endpoint: "https://crm.corp.local/api/lookup",
        method: "POST",
        paramSchema: { type: "object", properties: { customerId: { type: "string" } } },
        authType: "bearer-env",
        credentialEnv: "CRM_API_KEY",
      }).ok,
    ).toBe(true);
    expect(
      validateHttpToolConfig({ name: "x", endpoint: "not-a-url", method: "PUT", paramSchema: {} }).ok,
    ).toBe(false);
    expect(
      validateHttpToolConfig({
        name: "no-env",
        endpoint: "https://x.local",
        method: "GET",
        paramSchema: { type: "object", properties: {} },
        authType: "bearer-env",
      }).ok,
    ).toBe(false);
  });

  it("declaration binds egress scope to releases (D26)", () => {
    rawExec(db, "INSERT OR IGNORE INTO users (id, email) VALUES ('u-http', 'u@http.local')");
    rawExec(
      db,
      "INSERT OR IGNORE INTO agents (id, slug, name, owner_id) VALUES ('a-http', 'a-http', 'H', 'u-http')",
    );
    declareHttpTool(db, {
      name: "crm.lookup",
      endpoint: "https://crm.corp.local/api/lookup",
      method: "POST",
      paramSchema: { type: "object", properties: { customerId: { type: "string" } } },
      authType: "bearer-env",
      credentialEnv: "CRM_API_KEY",
    });
    rawExec(
      db,
      "INSERT OR IGNORE INTO agent_releases (id, agent_id, version, immutable_package_path, checksum, published_by) VALUES ('rel-http', 'a-http', '1.0.0', '/tmp', 'c', 'u-http')",
    );
    bindHttpToolToRelease(db, { releaseId: "rel-http", toolName: "crm.lookup" });
    expect(egressAllowlistForRelease(db, "rel-http")).toEqual(["crm.corp.local"]);
  });
});

describe("shared docs with ACL-first search (task 8.4 — AT-10)", () => {
  it("filters by user ACL before returning any content", async () => {
    // Finance docs: department-only. Marketing docs: everyone.
    rawExec(db, "INSERT OR IGNORE INTO departments (id, name) VALUES ('dept-fin', 'finance')");
    rawExec(db, "INSERT OR IGNORE INTO departments (id, name) VALUES ('dept-mkt', 'marketing')");
    rawExec(db, "INSERT OR IGNORE INTO users (id, email) VALUES ('fin-alice', 'fa@r.local')");
    rawExec(db, "INSERT OR IGNORE INTO users (id, email) VALUES ('mkt-bob', 'mb@r.local')");
    rawExec(db, "INSERT OR IGNORE INTO user_departments (user_id, department_id) VALUES ('fin-alice', 'dept-fin')");
    rawExec(db, "INSERT OR IGNORE INTO user_departments (user_id, department_id) VALUES ('mkt-bob', 'dept-mkt')");

    addSharedDocResource(db, {
      name: "财务制度",
      entries: [
        { id: "f1", title: "报销制度", content: "报销流程与预算规定" },
        { id: "f2", title: "薪酬结构", content: "内部薪酬分级说明" },
      ],
      grants: [{ subjectType: "department", subjectId: "dept-fin" }],
    });
    addSharedDocResource(db, {
      name: "品牌资料",
      entries: [
        { id: "m1", title: "品牌规范", content: "logo 使用与色彩规范" },
      ],
      grants: [{ subjectType: "all_users" }],
    });

    // Finance member sees finance + brand docs for their queries.
    const aliceSalary = await searchSharedDocs(db, { userId: "fin-alice", query: "薪酬" });
    expect(aliceSalary.map((h) => h.title)).toContain("薪酬结构");
    const aliceBrand = await searchSharedDocs(db, { userId: "fin-alice", query: "规范" });
    expect(aliceBrand.map((h) => h.title)).toContain("品牌规范");

    // Marketing member: finance content NEVER leaks (AT-10), even though
    // the query would match.
    const bobHits = await searchSharedDocs(db, { userId: "mkt-bob", query: "薪酬" });
    expect(bobHits).toEqual([]);
    const bobBrand = await searchSharedDocs(db, { userId: "mkt-bob", query: "规范" });
    expect(bobBrand.map((h) => h.title)).toEqual(["品牌规范"]);

    // A user with no grants sees no restricted content (all_users docs
    // stay visible to everyone by design — check a finance-only term).
    rawExec(db, "INSERT OR IGNORE INTO users (id, email) VALUES ('no-one', 'n@r.local')");
    expect(await searchSharedDocs(db, { userId: "no-one", query: "薪酬" })).toEqual([]);
  });
});
