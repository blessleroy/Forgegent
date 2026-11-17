/**
 * Controlled UI Schema (task 4.4, D24): field types, validation, and the
 * form-result template model. Pure logic — the React layer stays thin.
 */

export interface SchemaField {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "select" | "file";
  required?: boolean;
  options?: string[];
  placeholder?: string;
  defaultValue?: string | number;
}

export interface FormResultSchema {
  template: "form-result";
  fields: SchemaField[];
  resultHint?: string;
}

export interface DocumentFlowSchema {
  template: "document-flow";
  uploadField: SchemaField;
  outlineStage: { label: string };
  progressStage: { label: string };
  downloadStage: { label: string };
}

export type UiSchema = FormResultSchema | DocumentFlowSchema;

export interface FieldError {
  field: string;
  message: string;
}

/** Parse + structurally validate an untrusted UI schema. */
export function parseUiSchema(
  raw: unknown,
): { ok: true; schema: UiSchema } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const s = raw as {
    template?: string;
    fields?: { name?: string; label?: string; type?: string; options?: string[] }[];
    uploadField?: { name?: string };
  };
  if (!s || typeof s !== "object") return { ok: false, errors: ["schema must be an object"] };
  if (s.template === "form-result") {
    if (!Array.isArray(s.fields) || s.fields.length === 0) {
      errors.push("form-result requires a non-empty fields array");
    } else {
      for (const f of s.fields) {
        if (!f?.name || !f?.label) errors.push("each field needs name and label");
        if (f.type === "select" && (!Array.isArray(f.options) || f.options.length === 0)) {
          errors.push(`select field "${f.name}" requires options`);
        }
      }
    }
  } else if (s.template === "document-flow") {
    if (!s.uploadField?.name) errors.push("document-flow requires uploadField");
  } else {
    errors.push("template must be form-result or document-flow");
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, schema: raw as UiSchema };
}

/** Validate user input against a form schema (shared by client + server).
 *  `file` fields carry the uploaded file id (string) — required files must
 *  have one (remediation 2.14). */
export function validateFormInput(
  schema: FormResultSchema,
  values: Record<string, unknown>,
): { ok: true } | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = [];
  for (const field of schema.fields) {
    const value = values[field.name];
    const isEmpty =
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "");
    if (field.required && isEmpty) {
      errors.push({ field: field.name, message: `${field.label} is required` });
      continue;
    }
    if (isEmpty) continue;
    if (field.type === "number" && typeof value === "string" && !/^-?\d+(\.\d+)?$/.test(value)) {
      errors.push({ field: field.name, message: `${field.label} must be a number` });
    }
    if (field.type === "select" && !field.options?.includes(String(value))) {
      errors.push({ field: field.name, message: `${field.label} has an invalid option` });
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}
