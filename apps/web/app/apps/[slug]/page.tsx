"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import AppShell from "@/components/app-shell";
import { parseUiSchema, validateFormInput, type FormResultSchema } from "@/lib/ui-schema";
import { useLocale } from "@/lib/use-locale";

interface AgentDetail {
  id: string;
  slug: string;
  name: string;
  description: string;
}

export default function AppTaskPage() {
  const params = useParams<{ slug: string }>();
  const { t, locale } = useLocale();
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [schema, setSchema] = useState<FormResultSchema | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
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
              if (parsed.ok && parsed.schema.template === "form-result") {
                setSchema(parsed.schema as FormResultSchema);
                const defaults: Record<string, string> = {};
                for (const f of (parsed.schema as FormResultSchema).fields) {
                  if (f.defaultValue !== undefined) defaults[f.name] = String(f.defaultValue);
                }
                setValues(defaults);
              }
            });
        }
      });
  }, [params.slug]);

  async function submit() {
    if (!agent) return;
    let inputSummary: string;
    if (schema) {
      const check = validateFormInput(schema, values);
      if (!check.ok) {
        setError(check.errors.map((e) => e.message).join("；"));
        return;
      }
      inputSummary = schema.fields
        .map((f) => `${f.label}: ${values[f.name] ?? ""}`)
        .join("\n");
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
      body: JSON.stringify({ agentId: agent.id, inputSummary }),
    });
    setSubmitting(false);
    if (res.ok) {
      const data = await res.json();
      window.location.href = `/tasks/${data.task.id}`;
    } else {
      setError(locale === "zh" ? "提交失败，请稍后重试" : "Submit failed, try again");
    }
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

      {!schema ? (
        <div className="card" style={{ maxWidth: 640 }}>
          <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 14, lineHeight: 1.9 }}>
            {locale === "zh" ? "四步交付：" : "Four steps:"}
            {locale === "zh"
              ? " ① 上传需求 → ② 确认大纲 → ③ 生成 → ④ 下载文档"
              : " ① Requirements → ② Outline → ③ Generate → ④ Download"}
          </div>
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
      ) : (
        <div className="card" style={{ maxWidth: 640 }}>
          {schema.fields.map((field) => (
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
          ))}
        </div>
      )}

      {error ? <p className="form-error">{error}</p> : null}
      <button className="btn btn-primary" onClick={submit} disabled={submitting} style={{ marginTop: 8 }}>
        {submitting ? "…" : t("app.submit")}
      </button>
    </AppShell>
  );
}
