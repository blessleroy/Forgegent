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

  const loadDrafts = useCallback(async () => {
    const res = await fetch("/api/studio/drafts");
    if (res.ok) {
      const data = await res.json();
      setDrafts(data.drafts ?? []);
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

  return (
    <AppShell>
      <h1 className="page-title">{t("nav.studio")}</h1>
      <p className="page-sub">
        {locale === "zh"
          ? "用对话描述你要构建的应用；生成草稿后可继续修改、预览测试并送审。"
          : "Describe the app you want; iterate, preview-test and submit for review."}
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 20 }}>
        <aside>
          <div className="h2" style={{ marginTop: 0 }}>
            {locale === "zh" ? "我的草稿" : "Drafts"}
          </div>
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
              <button className="btn" onClick={runTest}>
                {locale === "zh" ? "预览测试" : "Preview run"}
              </button>
              <button className="btn btn-primary" onClick={submitForReview}>
                {locale === "zh" ? "提交审核" : "Submit for review"}
              </button>
            </div>
          ) : null}
          {error ? <p style={{ color: "var(--steel)", fontSize: 13, marginTop: 10 }}>{error}</p> : null}
        </section>
      </div>
    </AppShell>
  );
}
