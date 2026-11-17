/**
 * Builder agent backends (task 6.1 + remediation 2.1, D30/D34/D42).
 *
 * Two implementations behind one interface:
 * - LlmBuilderAgent: a direct OpenAI-compatible chat call (admin-configured
 *   endpoint; the generation process itself runs in-process and executes no
 *   model-generated code, so it is not a sandbox-mandatory subject — D38).
 * - HeuristicBuilderAgent: deterministic keyword fallback for offline/demo
 *   mode; Studio must label its output as such (never pass it off as LLM).
 */
import { rawQuery, type ForgegentDb } from "@forgegent/db";
import { validateDraftPayload, type DraftPayload } from "@forgegent/registry";

export interface GeneratedPlan {
  /** Structured requirement list shown to the builder. */
  requirements: string[];
  /** Missing-info clarifying questions (at least one round when needed). */
  clarifications: string[];
  /** Composition of what will be generated. */
  plan: string;
  payload: DraftPayload;
}

export interface ModificationResult {
  payload: DraftPayload;
  /** Human-readable change summary (diff detail). */
  changes: string[];
}

export interface BuilderAgentBackend {
  readonly kind: "llm" | "heuristic";
  generateDraft(brief: string): Promise<GeneratedPlan>;
  modifyDraft(current: DraftPayload, instruction: string): Promise<ModificationResult>;
}

/* ------------------------------ heuristic ------------------------------ */

interface Intent {
  kind: "poster" | "document" | "generic";
  name: string;
  fields: DraftPayload["ui"];
}

function detectIntent(brief: string): Intent {
  const text = brief.toLowerCase();
  if (/海报|poster|宣传图|配图/.test(text)) {
    return {
      kind: "poster",
      name: "海报设计师",
      fields: {
        type: "form-result",
        schema: {
          fields: [
            { name: "theme", label: "主题", type: "text", required: true },
            { name: "style", label: "风格", type: "select", required: true, options: ["简约", "喜庆", "商务"] },
            { name: "notes", label: "其他要求", type: "textarea" },
          ],
        },
      } as never,
    };
  }
  if (/方案|proposal|文档|word|docx|大纲/.test(text)) {
    return {
      kind: "document",
      name: "方案生成专家",
      fields: {
        type: "document-flow",
        schema: {
          uploadField: { name: "requirements", label: "客户需求", type: "textarea", required: true },
          outlineStage: { label: "大纲确认" },
          progressStage: { label: "生成进度" },
          downloadStage: { label: "下载文档" },
        },
      } as never,
    };
  }
  return {
    kind: "generic",
    name: "智能助手",
    fields: {
      type: "form-result",
      schema: {
        fields: [{ name: "input", label: "任务输入", type: "textarea", required: true }],
      },
    } as never,
  };
}

export class HeuristicBuilderAgent implements BuilderAgentBackend {
  readonly kind = "heuristic" as const;

  async generateDraft(brief: string): Promise<GeneratedPlan> {
    const intent = detectIntent(brief);
    const isPoster = intent.kind === "poster";
    const isDocument = intent.kind === "document";
    const payload: DraftPayload = {
      schemaVersion: "1.0",
      name: intent.name,
      description: brief.slice(0, 120),
      version: "0.1.0",
      ui: intent.fields,
      runtime: { engine: "pi-coding-agent", mode: "restricted" },
      modelRef: "default",
      ...(isPoster ? { toolRefs: ["image.generate"] } : { toolRefs: [] }),
      ...(isDocument ? { resourceRefs: [] } : {}),
      prompts: {
        system: isPoster
          ? `你是${intent.name}。根据用户输入的主题与风格调用 image.generate 工具生成海报。${brief}`
          : `你是${intent.name}。按阶段完成：资料理解 → 大纲确认 → 生成 → 交付。${brief}`,
      },
      tests: isPoster
        ? { cases: ["生成一张海报并返回图片", "修改文案后重新导出"] }
        : { cases: ["上传需求后生成大纲", "确认大纲后输出文档"] },
      usage: isPoster
        ? "输入主题与风格，生成海报后可下载；可继续对话修改。"
        : "上传客户需求，确认大纲后生成文档并下载。",
    };
    const clarifications: string[] = [];
    if (isPoster && !/(尺寸|比例|9:16|16:9)/.test(brief)) {
      clarifications.push("需要默认海报尺寸吗（未指定则使用 1024x1024）？");
    }
    if (isDocument && !/(参考|历史|资料库)/.test(brief)) {
      clarifications.push("是否需要引用企业历史方案资料？");
    }
    return {
      requirements: [
        `应用名称：${intent.name}`,
        `任务 UI 模板：${isDocument ? "document-flow（上传→大纲→进度→下载）" : "form-result（表单→结果预览→下载）"}`,
        `工具绑定：${isPoster ? "image.generate（管理员配置的生图端点）" : "无外部工具"}`,
        "测试用例已生成（提审时自动运行）",
      ],
      clarifications,
      plan: `将生成：Agent Prompt、UI Schema（${payload.ui.type}）、工具绑定声明、测试用例、使用说明。`,
      payload,
    };
  }

  async modifyDraft(current: DraftPayload, instruction: string): Promise<ModificationResult> {
    const changes: string[] = [];
    const next: DraftPayload = structuredClone(current);
    const text = instruction.toLowerCase();

    if (/上传|附件|参考图|文件/.test(text) && next.ui.type === "form-result") {
      const schema = next.ui.schema as { fields: { name: string; label: string; type: string }[] };
      if (!schema.fields.some((f) => f.type === "file")) {
        schema.fields.push({ name: "reference", label: "参考图/附件", type: "file" });
        changes.push("表单新增「参考图/附件」上传字段");
      }
    }
    if (/9:16|竖版|竖屏/.test(text)) {
      changes.push("生图尺寸调整为 9:16 竖版（默认参数）");
    }
    if (/word|docx|文档导出/.test(text) && next.ui.type === "form-result") {
      next.toolRefs = [...new Set([...(next.toolRefs ?? []), "document.export"]) ];
      changes.push("新增 document.export 工具绑定（Word 导出）");
    }
    if (/名称|改名|叫/.test(text)) {
      const match = instruction.match(/(?:改名为|叫)\s*["「「']?([^"」」',。]+)/);
      if (match?.[1]) {
        next.name = match[1].trim();
        changes.push(`应用名称改为「${next.name}」`);
      }
    }
    if (changes.length === 0) {
      next.description = `${current.description}\n[修改] ${instruction}`.slice(0, 200);
      changes.push("已记录修改要求到应用描述（无结构性变更）");
    }
    return { payload: next, changes };
  }
}

/* ---------------------------------- llm ---------------------------------- */

export interface BuilderEndpoint {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** Model-name resolution order: FORGEGENT_BUILDER_MODEL > resource config (D42). */
function builderModelName(configured?: string): string {
  return process.env.FORGEGENT_BUILDER_MODEL ?? configured ?? "gpt-4o-mini";
}

async function chatCompletion(
  endpoint: BuilderEndpoint,
  messages: { role: string; content: string }[],
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${endpoint.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${endpoint.apiKey}`,
      },
      body: JSON.stringify({
        model: endpoint.model,
        temperature: 0.2,
        max_tokens: 4096,
        messages,
      }),
    });
  } catch (error) {
    throw new Error(
      `builder 模型端点不可达（${endpoint.baseUrl}）：${String((error as Error).message).slice(0, 120)}`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `builder 模型端点返回 ${response.status}：${(await response.text().catch(() => "")).slice(0, 160)}`,
    );
  }
  const body = (await response.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[];
  } | null;
  const text = body?.choices?.[0]?.message?.content;
  if (!text) throw new Error("builder 模型端点未返回内容");
  return text;
}

/** Tolerant JSON extraction: first balanced top-level {...} in the text. */
function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("模型输出中没有 JSON 对象");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(text.slice(start, i + 1));
      }
    }
  }
  throw new Error("模型输出的 JSON 不完整");
}

const PAYLOAD_CONTRACT = `DraftPayload JSON 契约（严格输出，不要输出任何 JSON 以外的文字）：
{
  "schemaVersion": "1.0",
  "name": "应用名（中文可）",
  "description": "一句话描述",
  "icon": "emoji 或短图标标识（可选）",
  "version": "0.1.0",
  "ui": { "type": "form-result" | "document-flow", "schema": …
    // form-result: { "fields": [{ "name","label","type":"text|textarea|select|number|file","required","options?" }] }
    // document-flow: { "uploadField": {"name","label","type","required"}, "outlineStage": {"label"}, "progressStage": {"label"}, "downloadStage": {"label"} }
  },
  "runtime": { "engine": "pi-coding-agent", "mode": "restricted" },
  "modelRef": "default",
  "skillRefs": [],           // 仅当需要绑定已发布 Skill 时填 {id,version}
  "embeddedSkills": [],      // 需要生成新 Skill 时填 [{id(kebab),name,markdown(SKILL.md 正文)}]
  "toolRefs": [],            // 可用: image.generate, document.export, resources.search
  "resourceRefs": [],        // 需要引用的企业资源名（如共享资料库名），没有就留空数组
  "prompts": { "system": "员工任务的系统提示词（中文，写清职责与输出要求）" },
  "tests": { "cases": ["用例1", "用例2"] },
  "usage": "面向员工的使用说明（一两句）"
}`;

const GENERATE_SYSTEM = `你是 Forgegent 智体工坊的 Builder Agent。根据 Builder 的自然语言描述，为「员工使用的 Agent 应用」生成完整草稿。
要求：理解任意自然语言（不限关键词）；关键信息缺失时在 clarifications 里提出少量定向问题；生成物完整覆盖七类：Agent Prompt、Skill（必要时 embeddedSkills）、UI Schema、工具绑定、资源引用、测试用例、使用说明。
${PAYLOAD_CONTRACT}
外层包装：{ "requirements": ["结构化需求清单"], "clarifications": ["待补问题"], "plan": "拟生成内容概述", "payload": {…DraftPayload…} }`;

const MODIFY_SYSTEM = `你是 Forgegent 智体工坊的 Builder Agent。根据修改指令对当前 Agent 草稿做结构性修改（字段级变更，不是追加描述文字）。
${PAYLOAD_CONTRACT}
外层包装：{ "changes": ["变更说明"], "payload": {…完整修改后的 DraftPayload…} }`;

export class LlmBuilderAgent implements BuilderAgentBackend {
  readonly kind = "llm" as const;

  constructor(private readonly endpoint: BuilderEndpoint) {}

  async generateDraft(brief: string, feedback?: string): Promise<GeneratedPlan> {
    const ask = async (fb?: string) => {
      const user = fb
        ? `${brief}\n\n上一轮输出未通过校验，错误：\n${fb}\n请修正并重新输出完整 JSON。`
        : brief;
      const raw = await chatCompletion(this.endpoint, [
        { role: "system", content: GENERATE_SYSTEM },
        { role: "user", content: user.slice(0, 8000) },
      ]);
      return extractJson(raw) as {
        requirements?: unknown;
        clarifications?: unknown;
        plan?: unknown;
        payload?: unknown;
      };
    };
    let out = await ask(feedback);
    let parsed = toPlan(out);
    if (!parsed.ok) {
      out = await ask(parsed.errors.join("; "));
      parsed = toPlan(out);
      if (!parsed.ok) throw new Error(`LLM 草稿两次未通过校验：${parsed.errors.join("; ")}`);
    }
    return parsed.value;
  }

  async modifyDraft(current: DraftPayload, instruction: string): Promise<ModificationResult> {
    const ask = async (fb?: string) => {
      const user = `当前草稿：\n${JSON.stringify(current, null, 2).slice(0, 6000)}\n\n修改指令：${instruction}${
        fb ? `\n\n上一轮输出未通过校验，错误：\n${fb}\n请修正并重新输出完整 JSON。` : ""
      }`;
      const raw = await chatCompletion(this.endpoint, [
        { role: "system", content: MODIFY_SYSTEM },
        { role: "user", content: user.slice(0, 10000) },
      ]);
      return extractJson(raw) as { changes?: unknown; payload?: unknown };
    };
    let out = await ask();
    let parsed = toModification(out);
    if (!parsed.ok) {
      out = await ask(parsed.errors.join("; "));
      parsed = toModification(out);
      if (!parsed.ok) throw new Error(`LLM 修改两次未通过校验：${parsed.errors.join("; ")}`);
    }
    return parsed.value;
  }
}

function toPlan(
  out: { requirements?: unknown; clarifications?: unknown; plan?: unknown; payload?: unknown },
): { ok: true; value: GeneratedPlan } | { ok: false; errors: string[] } {
  const check = validateDraftPayload(out.payload);
  if (!check.ok) return { ok: false, errors: check.errors };
  const requirements = Array.isArray(out.requirements)
    ? out.requirements.map(String)
    : ["（模型未给出需求清单）"];
  const clarifications = Array.isArray(out.clarifications)
    ? out.clarifications.map(String)
    : [];
  return {
    ok: true,
    value: {
      requirements,
      clarifications,
      plan: typeof out.plan === "string" ? out.plan : "草稿已生成",
      payload: check.value,
    },
  };
}

function toModification(
  out: { changes?: unknown; payload?: unknown },
): { ok: true; value: ModificationResult } | { ok: false; errors: string[] } {
  const check = validateDraftPayload(out.payload);
  if (!check.ok) return { ok: false, errors: check.errors };
  return {
    ok: true,
    value: {
      payload: check.value,
      changes: Array.isArray(out.changes) ? out.changes.map(String) : ["草稿已按指令修改"],
    },
  };
}

/**
 * Backend selection (D30/D34/D42): the admin-configured OpenAI-compatible
 * endpoint drives the LLM backend; without a USABLE endpoint (no resource or
 * no resolvable key) the deterministic heuristic backend runs and Studio
 * must label the session "离线演示模式".
 */
export function resolveBuilderBackend(db: ForgegentDb): BuilderAgentBackend {
  const row = rawQuery<{ config: string }>(
    db,
    "SELECT config FROM resources WHERE kind = 'model_endpoint' ORDER BY created_at LIMIT 1",
  )[0];
  if (!row?.config) return new HeuristicBuilderAgent();
  let cfg: { baseUrl?: string; model?: string; apiKeyEnv?: string };
  try {
    cfg = JSON.parse(row.config);
  } catch {
    return new HeuristicBuilderAgent();
  }
  const apiKey = cfg.apiKeyEnv ? process.env[cfg.apiKeyEnv] ?? "" : "";
  if (!cfg.baseUrl || !apiKey) return new HeuristicBuilderAgent();
  return new LlmBuilderAgent({
    baseUrl: cfg.baseUrl,
    apiKey,
    model: builderModelName(cfg.model),
  });
}
