"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import AppShell from "@/components/app-shell";
import {
  parseUiSchema,
  validateFormInput,
  type DocumentFlowSchema,
  type FormResultSchema,
} from "@/lib/ui-schema";
import { useLocale } from "@/lib/use-locale";

interface AgentDetail {
  id: string;
  slug: string;
  name: string;
  description: string;
}

interface UploadedFile {
  id: string;
  filename: string;
}

/**
 * Remediation 2.14: BOTH templates render for real. form-result supports the
 * file field (upload → personal space → task inputFileIds); document-flow
 * renders its four stage blocks (upload → outline → progress → download),
 * driven by task state after submission (D45).
 */
export default function AppTaskPage() {
  const params = useParams<{ slug: string }>();
  const { t, locale } = useLocale();
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [form, setForm] = useState<FormResultSchema | null>(null);
  const [flow, setFlow] = useState<DocumentFlowSchema | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [uploads, setUploads] = useState<Record<string, UploadedFile | null>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/agents")
      .then((res) => res.json())
      .then((data) => {
        const found = (data.agents ?? []).find(
          (a: AgentDetail) => a.slug === params.slug,
        );
        setAgent(found ?? null);
        if (found) {
          fetch(`/api/agents/${found.id}/ui`)
            .then((res) => res.json())
            .then((payload) => {
              const parsed = parseUiSchema(payload.schema);
              if (!parsed.ok) return;
              if (parsed.schema.template === "form-result") {
                setForm(parsed.schema as FormResultSchema);
                const defaults: Record<string, string> = {};
                for (const f of (parsed.schema as FormResultSchema).fields) {
                  if (f.defaultValue !== undefined) defaults[f.name] = String(f.defaultValue);
                }
                setValues(defaults);
              } else {
                setFlow(parsed.schema as DocumentFlowSchema);
              }
            });
        }
      });
  }, [params.slug]);

  async function uploadFieldFile(fieldName: string, file: File | null) {
    if (!file) return;
    setUploading(fieldName);
    setError(null);
    const body = new FormData();
    body.append("file", file);
    const res = await fetch("/api/files", { method: "POST", body });
    setUploading(null);
    if (!res.ok) {
      setError(locale === "zh" ? `上传失败（${file.name}）` : `Upload failed (${file.name})`);
      return;
    }
    const saved = (await res.json()) as { id: string };
    setUploads((prev) => ({ ...prev, [fieldName]: { id: saved.id, filename: file.name } }));
  }

  async function submit() {
    if (!agent) return;
    let inputSummary: string;
    const inputFileIds: string[] = [];
    if (form) {
      // form-result: validate text/select values; file fields validate via
      // the uploaded ids (uploaded filenames count as the field value).
      const flat: Record<string, string> = { ...values };
      for (const field of form.fields) {
        if (field.type === "file") {
          const up = uploads[field.name];
          flat[field.name] = up ? up.filename : "";
          if (up) inputFileIds.push(up.id);
        }
      }
      const check = validateFormInput(form, flat);
      if (!check.ok) {
        setError(check.errors.map((e) => e.message).join("；"));
        return;
      }
      inputSummary = form.fields
        .map((f) => `${f.label}: ${f.type === "file" ? flat[f.name] || "（无）" : values[f.name] ?? ""}`)
        .join("\n");
    } else if (flow) {
      const text = values[flow.uploadField.name]?.trim();
      const up = uploads[flow.uploadField.name];
      if (flow.uploadField.required && !text && !up) {
        setError(locale === "zh" ? "请填写或上传需求" : "Describe or upload your requirements");
        return;
      }
      if (up) inputFileIds.push(up.id);
      inputSummary = `${flow.uploadField.label}: ${text ?? ""}${up ? `\n附件: ${up.filename}` : ""}`;
    } else {
      if (!values.requirements?.trim()) {
        setError(locale === "zh" ? "请描述你的需求" : "Describe your requirements");
        return;
      }
      inputSummary = `需求: ${values.requirements}`;
    }
    setError(null);
    setSubmitting(true);
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId: agent.id, inputSummary, inputFileIds }),
    });
    setSubmitting(false);
    if (res.ok) {
      const data = await res.json();
      window.location.href = `/tasks/${data.task.id}`;
    } else {
      setError(locale === "zh" ? "提交失败，请稍后重试" : "Submit failed, try again");
    }
  }

  function fileField(name: string, label: string, required?: boolean) {
    const up = uploads[name];
    return (
      <div className="field" key={name}>
        <label>
          {label}
          {required ? <span className="req">*</span> : null}
        </label>
        <input
          className="input"
          type="file"
          onChange={(e) => void uploadFieldFile(name, e.target.files?.[0] ?? null)}
        />
        <div className="hint">
          {uploading === name
            ? "…"
            : up
              ? `📎 ${up.filename}`
              : locale === "zh"
                ? "上传到个人文件空间，作为任务输入"
                : "Uploaded to your personal space as task input"}
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <AppShell>
        <p style={{ color: "var(--ink-faint)" }}>{t("common.loading")}</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <h1 className="page-title">{agent.name}</h1>
      <p className="page-sub">{agent.description}</p>

      {flow ? (
        /* document-flow: four stage blocks, state-driven after submit (D45). */
        <div className="card" style={{ maxWidth: 680 }}>
          <div
            style={{
              display: "flex",
              gap: 8,
              fontSize: 12,
              marginBottom: 16,
              color: "var(--ink-soft)",
            }}
          >
            {[`① ${flow.uploadField.label}`,
              `② ${flow.outlineStage.label}`,
              `③ ${flow.progressStage.label}`,
              `④ ${flow.downloadStage.label}`].map((label, i) => (
              <span
                key={i}
                className="badge s-pending"
                style={{ fontSize: 11 }}
              >
                {label}
              </span>
            ))}
          </div>
          {flow.uploadField.type === "file"
            ? fileField(flow.uploadField.name, flow.uploadField.label, flow.uploadField.required)
            : null}
          <div className="field">
            <label>
              {flow.uploadField.type === "file"
                ? locale === "zh"
                  ? "补充说明（可选）"
                  : "Additional notes (optional)"
                : flow.uploadField.label}
              {flow.uploadField.required && flow.uploadField.type !== "file" ? (
                <span className="req">*</span>
              ) : null}
            </label>
            <textarea
              className="input"
              rows={5}
              placeholder={flow.uploadField.placeholder ?? (locale === "zh" ? "粘贴或描述你的需求…" : "Paste or describe…")}
              value={values[flow.uploadField.name] ?? ""}
              onChange={(e) => setValues({ ...values, [flow.uploadField.name]: e.target.value })}
            />
            <div className="hint">
              {locale === "zh"
                ? "提交后：确认大纲（任务页消息区）→ 生成 → 下载。页面关闭不影响执行。"
                : "After submit: confirm the outline in the task page, then generate & download."}
            </div>
          </div>
        </div>
      ) : form ? (
        <div className="card" style={{ maxWidth: 640 }}>
          {form.fields.map((field) =>
            field.type === "file" ? (
              fileField(field.name, field.label, field.required)
            ) : (
              <div key={field.name} className="field">
                <label>
                  {field.label}
                  {field.required ? <span className="req">*</span> : null}
                </label>
                {field.type === "select" ? (
                  <select
                    className="input"
                    value={values[field.name] ?? ""}
                    onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
                  >
                    <option value="">—</option>
                    {field.options?.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : field.type === "textarea" ? (
                  <textarea
                    className="input"
                    rows={3}
                    placeholder={field.placeholder}
                    value={values[field.name] ?? ""}
                    onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
                  />
                ) : (
                  <input
                    className="input"
                    type={field.type === "number" ? "number" : "text"}
                    placeholder={field.placeholder}
                    value={values[field.name] ?? ""}
                    onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
                  />
                )}
                <div className="hint">{field.placeholder ?? ""}</div>
              </div>
            ),
          )}
        </div>
      ) : (
        <div className="card" style={{ maxWidth: 640 }}>
          <div className="field">
            <label>
              {locale === "zh" ? "需求描述" : "Requirements"}
              <span className="req">*</span>
            </label>
            <textarea
              className="input"
              rows={5}
              placeholder={locale === "zh" ? "粘贴或描述你的需求…" : "Paste or describe…"}
              value={values.requirements ?? ""}
              onChange={(e) => setValues({ ...values, requirements: e.target.value })}
            />
          </div>
        </div>
      )}

      {error ? <p className="form-error">{error}</p> : null}
      <button className="btn btn-primary" onClick={submit} disabled={submitting} style={{ marginTop: 8 }}>
        {submitting ? "…" : t("app.submit")}
      </button>
    </AppShell>
  );
}
