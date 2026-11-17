"use client";

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/app-shell";
import { useLocale } from "@/lib/use-locale";

interface DraftRow {
  id: string;
  slug: string;
  name: string;
  version: string;
  state: string;
  reviewNote?: string | null;
}

interface ChatMessage {
  role: "builder" | "agent";
  text: string;
  clarifications?: string[];
  changes?: string[];
}

export default function StudioPage() {
  const { t, locale } = useLocale();
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [activeDraft, setActiveDraft] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishedReleases, setPublishedReleases] = useState<
    { id: string; version: string; slug: string; name: string; isActive: number }[]
  >([]);
  const [showCopy, setShowCopy] = useState(false);
  /** Employee-view schema preview (R4.1) — the SAME payload the Hub renders. */
  const [preview, setPreview] = useState<{
    ui: { type: string; schema: unknown };
    usage?: string;
  } | null>(null);
  /** "heuristic" means 离线演示模式 — must be labelled (D30). */
  const [builderBackend, setBuilderBackend] = useState<"llm" | "heuristic" | null>(null);

  const loadDrafts = useCallback(async () => {
    const res = await fetch("/api/studio/drafts");
    if (res.ok) {
      const data = await res.json();
      setDrafts(data.drafts ?? []);
      setBuilderBackend(data.builderBackend ?? null);
    }
    const relRes = await fetch("/api/studio/releases");
    if (relRes.ok) {
      const data = await relRes.json();
      setPublishedReleases(data.releases ?? []);
    }
  }, []);

  const loadConversation = useCallback(async (draftId: string) => {
    const res = await fetch(`/api/studio/drafts/${draftId}/test`);
    if (res.ok) {
      const data = await res.json();
      setMessages(data.messages ?? []);
    }
  }, []);

  useEffect(() => {
    void loadDrafts();
  }, [loadDrafts]);

  async function send() {
    if (!input.trim() || busy) return;
    setBusy(true);
    setError(null);
    setMessages((prev) => [...prev, { role: "builder", text: input }]);
    const res = await fetch("/api/studio/drafts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        activeDraft ? { draftId: activeDraft, message: input } : { slug, message: input },
      ),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.detail ?? body.error ?? "请求失败");
      return;
    }
    const data = await res.json();
    if (!activeDraft) setActiveDraft(data.draftId);
    setMessages((prev) => [...prev, data.message as ChatMessage]);
    setInput("");
    await loadDrafts();
  }

  async function runTest() {
    if (!activeDraft) return;
    const res = await fetch(`/api/studio/drafts/${activeDraft}/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "run-test", inputSummary: "预览测试" }),
    });
    if (res.ok) {
      setError(`预览任务已创建：${(await res.json()).taskId}`);
    } else {
      setError(String(await res.text()));
    }
  }

  async function submitForReview() {
    if (!activeDraft) return;
    const res = await fetch(`/api/studio/drafts/${activeDraft}/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "submit" }),
    });
    const data = await res.json();
    setError(
      res.ok
        ? `已提审。自动测试：${data.gate.summary}`
        : `提审失败：${JSON.stringify(data)}`,
    );
    await loadDrafts();
  }

  async function withdrawReview() {
    if (!activeDraft) return;
    const res = await fetch(`/api/studio/drafts/${activeDraft}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "withdraw" }),
    });
    setError(res.ok ? "已撤回，草稿回到可编辑状态。" : `撤回失败：${await res.text()}`);
    await loadDrafts();
  }

  async function togglePreview() {
    if (preview) {
      setPreview(null);
      return;
    }
    if (!activeDraft) return;
    const res = await fetch(`/api/studio/drafts/${activeDraft}/test`);
    if (res.ok) {
      const data = await res.json();
      setPreview(data.payload ?? null);
    }
  }

  async function copyRelease(releaseId: string) {
    const res = await fetch("/api/studio/copy-release", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ releaseId }),
    });
    if (res.ok) {
      const draft = await res.json();
      setActiveDraft(draft.draftId);
      await loadConversation(draft.draftId);
      setShowCopy(false);
      setError(`已复制为新草稿（版本 ${draft.payload.version}），可继续修改。`);
    } else {
      setError(`复制失败: ${await res.text()}`);
    }
    await loadDrafts();
  }

  return (
    <AppShell>
      <h1 className="page-title">{t("nav.studio")}</h1>
      <p className="page-sub">
        {locale === "zh"
          ? "用对话描述你要构建的应用；生成草稿后可继续修改、预览测试并送审。"
          : "Describe the app you want; iterate, preview-test and submit for review."}
      </p>
      {builderBackend === "heuristic" ? (
        <div
          className="card"
          style={{ padding: "8px 12px", marginBottom: 12, borderColor: "var(--molten)", fontSize: 13 }}
        >
          ⚠️{" "}
          {locale === "zh"
            ? "离线演示模式：未配置可用的模型端点，草稿由确定性启发式后端生成（非 LLM）。"
            : "Offline demo mode: no usable model endpoint configured — drafts come from the deterministic heuristic backend (not an LLM)."}
        </div>
      ) : null}
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 20 }}>
        <aside>
          <div className="h2" style={{ marginTop: 0, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            {locale === "zh" ? "我的草稿" : "Drafts"}
            <button className="btn btn-sm" onClick={() => setShowCopy(!showCopy)}>
              {locale === "zh" ? "复制发布版本" : "Copy release"}
            </button>
          </div>
          {showCopy ? (
            <div className="card" style={{ padding: 10, marginBottom: 10, maxHeight: 200, overflowY: "auto" }}>
              {publishedReleases.length === 0 ? (
                <p style={{ fontSize: 12, color: "var(--ink-faint)", margin: 0 }}>
                  {locale === "zh" ? "暂无已发布版本" : "No releases"}
                </p>
              ) : (
                publishedReleases.map((r) => (
                  <div
                    key={r.id}
                    onClick={() => copyRelease(r.id)}
                    style={{ padding: "4px 0", cursor: "pointer", fontSize: 13, borderBottom: "1px solid #f0f0f0" }}
                  >
                    <strong>{r.name}</strong>{" "}
                    <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-soft)" }}>
                      @{r.version} {r.isActive ? "●" : ""}
                    </span>
                  </div>
                ))
              )}
            </div>
          ) : null}
          {drafts.map((draft) => (
            <div
              key={draft.id}
              onClick={() => {
                setActiveDraft(draft.id);
                void loadConversation(draft.id);
              }}
              className="card"
              style={{
                padding: "10px 12px",
                marginBottom: 8,
                cursor: "pointer",
                borderColor: activeDraft === draft.id ? "var(--molten)" : "var(--line)",
              }}
            >
              <strong style={{ fontSize: 14 }}>{draft.name}</strong>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", fontFamily: "var(--mono)" }}>
                {draft.slug} · {draft.version} ·{" "}
                <span className={`badge s-${draft.state === "in_review" ? "running" : "pending"}`} style={{ fontSize: 11 }}>
                  {draft.state}
                </span>
              </div>
              {draft.reviewNote ? (
                <div style={{ fontSize: 12, color: "var(--steel)", marginTop: 4 }}>
                  📝 {locale === "zh" ? "审核意见" : "Review note"}: {draft.reviewNote}
                </div>
              ) : null}
            </div>
          ))}
          {drafts.length === 0 ? (
            <p style={{ color: "var(--ink-faint)", fontSize: 13 }}>
              {locale === "zh" ? "还没有草稿——从右侧对话开始。" : "No drafts yet — start on the right."}
            </p>
          ) : null}
        </aside>
        <section>
          {!activeDraft ? (
            <div className="field" style={{ maxWidth: 360 }}>
              <label>
                {locale === "zh" ? "新应用标识（slug）" : "New app slug"}
              </label>
              <input
                className="input"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="my-poster-agent"
                style={{ fontFamily: "var(--mono)" }}
              />
              <div className="hint">
                {locale === "zh" ? "小写字母、数字与连字符，创建后不可改。" : "lowercase kebab-case, immutable."}
              </div>
            </div>
          ) : null}
          <div className="chat-box">
            {messages.length === 0 ? (
              <p style={{ color: "var(--ink-faint)", textAlign: "center", marginTop: 140 }}>
                {locale === "zh"
                  ? "例如：创建一个活动海报 Agent，员工输入主题和风格，自动出图。"
                  : 'e.g. "Create a poster agent: staff enter theme & style."'}
              </p>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={`chat-msg from-${m.role}`}>
                  <div className="bubble">{m.text}</div>
                  {m.clarifications?.length ? (
                    <div className="clarify">❓ {m.clarifications.join(" / ")}</div>
                  ) : null}
                </div>
              ))
            )}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <input
              className="input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={activeDraft ? (locale === "zh" ? "描述修改要求…" : "Describe the change…") : t("app.input")}
              onKeyDown={(e) => e.key === "Enter" && send()}
            />
            <button className="btn btn-primary" onClick={send} disabled={busy || (!activeDraft && !slug)}>
              {busy ? "…" : locale === "zh" ? "发送" : "Send"}
            </button>
          </div>
          {activeDraft ? (
            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <button className="btn" onClick={togglePreview}>
                {preview
                  ? locale === "zh" ? "关闭预览" : "Hide preview"
                  : locale === "zh" ? "员工视角预览" : "Employee view"}
              </button>
              <button className="btn" onClick={runTest}>
                {locale === "zh" ? "预览测试" : "Preview run"}
              </button>
              <button className="btn btn-primary" onClick={submitForReview}>
                {locale === "zh" ? "提交审核" : "Submit for review"}
              </button>
              {drafts.find((d) => d.id === activeDraft)?.state === "in_review" ? (
                <button className="btn btn-danger" onClick={withdrawReview}>
                  {locale === "zh" ? "撤回审核" : "Withdraw"}
                </button>
              ) : null}
            </div>
          ) : null}
          {preview ? (
            <div className="card" style={{ marginTop: 12, padding: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                {locale === "zh" ? "员工视角预览（Hub 同款 Schema 渲染）" : "Employee view (same schema the Hub renders)"}
              </div>
              {preview.ui?.type === "document-flow" ? (
                (() => {
                  const schema = preview.ui.schema as {
                    uploadField?: { label?: string };
                    outlineStage?: { label?: string };
                    progressStage?: { label?: string };
                    downloadStage?: { label?: string };
                  };
                  return (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
                      {[
                        `① ${schema.uploadField?.label ?? (locale === "zh" ? "上传需求" : "Upload")}`,
                        `② ${schema.outlineStage?.label ?? (locale === "zh" ? "大纲确认" : "Outline")}`,
                        `③ ${schema.progressStage?.label ?? (locale === "zh" ? "生成进度" : "Progress")}`,
                        `④ ${schema.downloadStage?.label ?? (locale === "zh" ? "下载" : "Download")}`,
                      ].map((label) => (
                        <span key={label} className="badge s-pending" style={{ fontSize: 11 }}>{label}</span>
                      ))}
                    </div>
                  );
                })()
              ) : (
                (() => {
                  const fields =
                    ((preview.ui.schema as { fields?: { name: string; label: string; type: string; required?: boolean; options?: string[] }[] })
                      ?.fields) ?? [];
                  return (
                    <div>
                      {fields.map((f) => (
                        <div key={f.name} className="field">
                          <label>
                            {f.label}
                            {f.required ? <span className="req">*</span> : null}
                          </label>
                          {f.type === "select" ? (
                            <select className="input" disabled>
                              {(f.options ?? []).map((o) => (
                                <option key={o}>{o}</option>
                              ))}
                            </select>
                          ) : f.type === "textarea" ? (
                            <textarea className="input" rows={3} disabled />
                          ) : (
                            <input className="input" type={f.type === "number" ? "number" : f.type === "file" ? "file" : "text"} disabled />
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })()
              )}
              {preview.usage ? (
                <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 8 }}>
                  {locale === "zh" ? "使用说明" : "Usage"}: {preview.usage}
                </div>
              ) : null}
            </div>
          ) : null}
          {error ? <p style={{ color: "var(--steel)", fontSize: 13, marginTop: 10 }}>{error}</p> : null}
        </section>
      </div>
    </AppShell>
  );
}
