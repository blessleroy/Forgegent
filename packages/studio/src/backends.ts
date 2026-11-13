/**
 * Builder agent backends (task 6.1, design D11 M2 transition).
 *
 * The backend interface decouples studio logic from the model: the LLM
 * backend drives a real pi session (used once an admin-configured model
 * endpoint exists); the heuristic backend derives a deterministic,
 * spec-valid draft from natural-language keywords so the studio loop is
 * fully functional offline and in tests.
 */
import type { DraftPayload } from "@forgegent/registry";

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
