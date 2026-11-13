"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
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
  const { t } = useLocale();
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
                setSchema(parsed.schema);
                const defaults: Record<string, string> = {};
                for (const f of parsed.schema.fields) {
                  if (f.defaultValue !== undefined) defaults[f.name] = String(f.defaultValue);
                }
                setValues(defaults);
              }
            });
        }
      });
  }, [params.slug]);

  async function submit() {
    if (!schema || !agent) return;
    const check = validateFormInput(schema, values);
    if (!check.ok) {
      setError(check.errors.map((e) => e.message).join("; "));
      return;
    }
    setError(null);
    setSubmitting(true);
    const inputSummary = schema.fields
      .map((f) => `${f.label}: ${values[f.name] ?? ""}`)
      .join("\n");
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
      setError(String(await res.text()));
    }
  }

  if (!agent) {
    return (
      <main style={{ padding: "2rem", fontFamily: "system-ui" }}>{t("common.loading")}</main>
    );
  }
  return (
    <main style={{ maxWidth: 700, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>{agent.name}</h1>
      <p style={{ color: "#666" }}>{agent.description}</p>
      <h2>{t("app.input")}</h2>
      {schema?.fields.map((field) => (
        <div key={field.name} style={{ marginBottom: 12 }}>
          <label style={{ display: "block", marginBottom: 4 }}>
            {field.label}
            {field.required ? " *" : ""}
          </label>
          {field.type === "select" ? (
            <select
              value={values[field.name] ?? ""}
              onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
              style={{ padding: 8, width: "100%" }}
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
              rows={3}
              placeholder={field.placeholder}
              value={values[field.name] ?? ""}
              onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
              style={{ padding: 8, width: "100%" }}
            />
          ) : (
            <input
              type={field.type === "number" ? "number" : "text"}
              placeholder={field.placeholder}
              value={values[field.name] ?? ""}
              onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
              style={{ padding: 8, width: "100%" }}
            />
          )}
        </div>
      ))}
      {error ? <p style={{ color: "#c02929" }}>{error}</p> : null}
      <button onClick={submit} disabled={submitting} style={{ padding: "10px 20px" }}>
        {submitting ? "…" : t("app.submit")}
      </button>
    </main>
  );
}
