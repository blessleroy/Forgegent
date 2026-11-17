/**
 * R2.1-2.3 regressions: the LLM builder backend (D30/D34/D42) and the D37
 * reference validation.
 *
 * - LlmBuilderAgent: tolerant JSON extraction, strict payload validation,
 *   exactly one retry with feedback, hard error after the second failure.
 * - resolveBuilderBackend: heuristic offline fallback rules.
 * - validateDraftReferences: unauthorized skill / undeclared http tool /
 *   unknown resource refuse the save with usable lists (nothing dropped).
 */
import { describe, expect, it } from "vitest";
import {
  HeuristicBuilderAgent,
  LlmBuilderAgent,
  resolveBuilderBackend,
} from "../src/backends.js";
import { validateDraftReferences, RegistryError } from "@forgegent/registry";
import { createTestDb, rawExec } from "@forgegent/db";

/* ----------------------------- llm backend ----------------------------- */

const VALID_PLAN = {
  requirements: ["海报应用", "9:16"],
  clarifications: [],
  plan: "生成 form-result 海报应用",
  payload: {
    schemaVersion: "1.0",
    name: "海报设计师",
    description: "活动海报",
    version: "0.1.0",
    ui: {
      type: "form-result",
      schema: { fields: [{ name: "theme", label: "主题", type: "text", required: true }] },
    },
    runtime: { engine: "pi-coding-agent", mode: "restricted" },
    modelRef: "default",
    toolRefs: ["image.generate"],
    resourceRefs: [],
    prompts: { system: "生成海报" },
    tests: { cases: ["生成一张"] },
    usage: "输入主题与风格",
  },
};

function chatResponse(content: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function stubFetch(responses: (string | Response)[]): {
  calls: string[];
  bodies: string[];
} {
  const calls: string[] = [];
  const bodies: string[] = [];
  let i = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(input));
    bodies.push(String(init?.body ?? ""));
    const item = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return typeof item === "string" ? chatResponse(item) : item;
  }) as typeof fetch;
  return { calls, bodies };
}

const endpoint = { baseUrl: "http://models.local/v1", apiKey: "k", model: "test-model" };

describe("R2 task 2.1 — LlmBuilderAgent", () => {
  it("extracts JSON from fenced output and validates the payload", async () => {
    stubFetch(["前置说明\n```json\n" + JSON.stringify(VALID_PLAN) + "\n```\n收尾"]);
    const agent = new LlmBuilderAgent(endpoint);
    const plan = await agent.generateDraft("做一个海报应用");
    expect(agent.kind).toBe("llm");
    expect(plan.payload.name).toBe("海报设计师");
    expect(plan.payload.usage).toBe("输入主题与风格");
  });

  it("retries ONCE with validation feedback, then succeeds", async () => {
    const broken = { ...VALID_PLAN, payload: { ...VALID_PLAN.payload, name: "" } };
    const { calls } = stubFetch([JSON.stringify(broken), JSON.stringify(VALID_PLAN)]);
    const agent = new LlmBuilderAgent(endpoint);
    const plan = await agent.generateDraft("海报");
    expect(plan.payload.name).toBe("海报设计师");
    expect(calls.length).toBe(2);
  });

  it("throws (no silent fallback) after the second invalid output", async () => {
    const broken = { ...VALID_PLAN, payload: { ...VALID_PLAN.payload, version: "x" } };
    stubFetch([JSON.stringify(broken), JSON.stringify(broken)]);
    const agent = new LlmBuilderAgent(endpoint);
    await expect(agent.generateDraft("海报")).rejects.toThrow(/两次未通过校验/);
  });

  it("modifyDraft returns structured changes against the current payload", async () => {
    const modified = {
      changes: ["新增参考图上传字段"],
      payload: {
        ...VALID_PLAN.payload,
        ui: {
          type: "form-result" as const,
          schema: {
            fields: [
              { name: "theme", label: "主题", type: "text", required: true },
              { name: "reference", label: "参考图", type: "file" },
            ],
          },
        },
      },
    };
    stubFetch([JSON.stringify(modified)]);
    const agent = new LlmBuilderAgent(endpoint);
    const result = await agent.modifyDraft(VALID_PLAN.payload, "增加参考图上传");
    expect(result.changes).toEqual(["新增参考图上传字段"]);
    const fields = (result.payload.ui.schema as { fields: { name: string }[] }).fields;
    expect(fields.some((f) => f.name === "reference")).toBe(true);
  });
});

describe("R2 task 2.1 — resolveBuilderBackend (offline demo mode rules)", () => {
  it("no endpoint resource -> heuristic", () => {
    const db = createTestDb();
    expect(resolveBuilderBackend(db).kind).toBe("heuristic");
  });

  it("endpoint resource without a resolvable key -> heuristic (not a broken LLM)", () => {
    const db = createTestDb();
    rawExec(
      db,
      "INSERT INTO resources (id, kind, name, config) VALUES ('ep1', 'model_endpoint', 'main', ?)",
      JSON.stringify({ baseUrl: "http://m.local/v1", model: "m1", apiKeyEnv: "MISSING_KEY" }),
    );
    expect(resolveBuilderBackend(db).kind).toBe("heuristic");
  });

  it("endpoint resource + key -> llm; FORGEGENT_BUILDER_MODEL overrides the model name", async () => {
    const db = createTestDb();
    process.env.__R2_TEST_KEY = "secret";
    process.env.FORGEGENT_BUILDER_MODEL = "builder-7b";
    try {
      rawExec(
        db,
        "INSERT INTO resources (id, kind, name, config) VALUES ('ep2', 'model_endpoint', 'main', ?)",
        JSON.stringify({ baseUrl: "http://m.local/v1", model: "chat-1", apiKeyEnv: "__R2_TEST_KEY" }),
      );
      const backend = resolveBuilderBackend(db);
      expect(backend.kind).toBe("llm");
      const { calls, bodies } = stubFetch([JSON.stringify(VALID_PLAN)]);
      await (backend as LlmBuilderAgent).generateDraft("海报");
      expect(calls[0]).toContain("/chat/completions");
      expect(bodies[0]).toContain('"model":"builder-7b"');
    } finally {
      delete process.env.__R2_TEST_KEY;
      delete process.env.FORGEGENT_BUILDER_MODEL;
    }
  });
});

/* ------------------------- D37 reference validation ------------------------- */

describe("R2 task 2.3 — validateDraftReferences (D37)", () => {
  const basePayload = {
    schemaVersion: "1.0" as const,
    name: "App",
    description: "d",
    version: "0.1.0",
    ui: { type: "form-result" as const, schema: { fields: [] } },
    runtime: { engine: "pi-coding-agent" as const, mode: "restricted" as const },
    modelRef: "default",
    skillRefs: [],
    toolRefs: ["image.generate"],
    resourceRefs: [],
  };

  function seed(db: ReturnType<typeof createTestDb>) {
    rawExec(db, "INSERT INTO users (id, email) VALUES ('b1', 'b@t.local'), ('adm', 'a@t.local')");
    rawExec(db, "INSERT INTO skills (id, slug, name, created_by) VALUES ('sk1', 'poster', 'Poster', 'adm')");
    rawExec(db, "INSERT INTO skill_versions (id, skill_id, version, package_path, checksum, status) VALUES ('sv1', 'sk1', '1.0.0', '/p', 'h', 'published')");
    rawExec(db, "INSERT INTO resources (id, kind, name, config) VALUES ('r1', 'shared_doc', '资料库', '{}')");
  }

  it("unauthorized skillRef refuses the save and lists bindable skills", () => {
    const db = createTestDb();
    seed(db);
    expect(() =>
      validateDraftReferences(db, "b1", {
        ...basePayload,
        skillRefs: [{ id: "poster", version: "1.0.0" }],
      }),
    ).toThrow(RegistryError);
    // After the admin grants the binding the same reference passes.
    rawExec(db, "INSERT INTO skill_bindings (skill_id, builder_id, granted_by) VALUES ('sk1', 'b1', 'adm')");
    expect(() =>
      validateDraftReferences(db, "b1", {
        ...basePayload,
        skillRefs: [{ id: "poster", version: "1.0.0" }],
      }),
    ).not.toThrow();
  });

  it("undeclared http.* tool refuses; declared one passes (advisory ids pass)", () => {
    const db = createTestDb();
    seed(db);
    expect(() =>
      validateDraftReferences(db, "b1", { ...basePayload, toolRefs: ["http.crm-lookup"] }),
    ).toThrow(/未由管理员声明/);
    rawExec(
      db,
      "INSERT INTO resources (id, kind, name, config) VALUES ('h1', 'http_tool', 'crm-lookup', ?)",
      JSON.stringify({ name: "crm-lookup", endpoint: "https://crm.local/api", method: "GET", paramSchema: { type: "object", properties: {} }, authType: "none" }),
    );
    expect(() =>
      validateDraftReferences(db, "b1", { ...basePayload, toolRefs: ["http.crm-lookup", "artifact.save"] }),
    ).not.toThrow(); // artifact.save: PRD §6 sample id, advisory
  });

  it("unknown resourceRef refuses with the available list", () => {
    const db = createTestDb();
    seed(db);
    expect(() =>
      validateDraftReferences(db, "b1", { ...basePayload, resourceRefs: ["不存在的库"] }),
    ).toThrow(/不存在/);
    expect(() =>
      validateDraftReferences(db, "b1", { ...basePayload, resourceRefs: ["资料库"] }),
    ).not.toThrow();
  });
});

// Silence unused heuristic import (kept for type parity of the suite).
void HeuristicBuilderAgent;
