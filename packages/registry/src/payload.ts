/**
 * Agent application draft payload (PRD §6 manifest semantics).
 * modelRef/resourceRefs are capability references — never secrets or real
 * internal paths.
 */
export interface DraftPayload {
  schemaVersion: "1.0";
  name: string;
  description: string;
  icon?: string;
  /** Proposed version for the next release (semver). */
  version: string;
  ui: { type: "form-result" | "document-flow"; schema: unknown };
  runtime: { engine: "pi-coding-agent"; mode: "restricted" | "sandboxed" };
  modelRef?: string;
  skillRefs?: { id: string; version: string; sha256?: string }[];
  /**
   * Generated skill drafts embedded in the app package (D46): published as
   * skill_versions at agent-release approval time (连带审核), never before.
   */
  embeddedSkills?: { id: string; name: string; markdown: string }[];
  toolRefs?: string[];
  resourceRefs?: string[];
  prompts?: { system: string };
  tests?: unknown;
  /** Employee-facing usage instructions (FR-01.3 使用说明). */
  usage?: string;
}

export function validateDraftPayload(
  payload: unknown,
): { ok: true; value: DraftPayload } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const p = payload as Partial<DraftPayload>;
  if (!p || typeof p !== "object") return { ok: false, errors: ["payload must be an object"] };
  if (p.schemaVersion !== "1.0") errors.push("schemaVersion must be \"1.0\"");
  if (!p.name || typeof p.name !== "string") errors.push("name is required");
  if (!p.version || !/^\d+\.\d+\.\d+$/.test(p.version)) {
    errors.push("version must be semver (e.g. 1.0.0)");
  }
  if (!p.ui || (p.ui.type !== "form-result" && p.ui.type !== "document-flow")) {
    errors.push("ui.type must be form-result or document-flow");
  }
  if (!p.runtime || (p.runtime.mode !== "restricted" && p.runtime.mode !== "sandboxed")) {
    errors.push("runtime.mode must be restricted or sandboxed");
  }
  if (p.runtime?.engine !== "pi-coding-agent") {
    errors.push("runtime.engine must be pi-coding-agent");
  }
  if (p.usage !== undefined && typeof p.usage !== "string") {
    errors.push("usage must be a string");
  }
  if (p.embeddedSkills !== undefined) {
    if (!Array.isArray(p.embeddedSkills)) {
      errors.push("embeddedSkills must be an array");
    } else {
      for (const skill of p.embeddedSkills) {
        if (!skill || typeof skill !== "object") {
          errors.push("embeddedSkills entries must be objects");
          break;
        }
        if (!/^[a-z0-9][a-z0-9-]*$/.test(String(skill.id))) {
          errors.push(`embeddedSkills[${skill.id}] id must be kebab-case`);
        }
        if (!skill.name || !skill.markdown) {
          errors.push(`embeddedSkills[${skill.id}] requires name and markdown`);
        }
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: payload as DraftPayload };
}

/** Stable serialization for checksums (key-sorted, no whitespace). */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([k, item]) => [k, sort(item)]),
      );
    }
    return v;
  };
  return JSON.stringify(sort(value));
}
