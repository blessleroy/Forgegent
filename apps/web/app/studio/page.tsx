"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/use-locale";

interface DraftRow {
  id: string;
  slug: string;
  name: string;
  version: string;
  state: string;
  autoTestResult: string | null;
}

interface ChatMessage {
  role: "builder" | "agent";
  text: string;
  clarifications?: string[];
  changes?: string[];
}

export default function StudioPage() {
  const { t } = useLocale();
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
      setError(String(await res.text()));
      return;
    }
    const data = await res.json();
    if (!activeDraft) {
      setActiveDraft(data.draftId);
    }
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
    <main style={{ maxWidth: 1000, margin: "2rem auto", fontFamily: "system-ui", display: "grid", gridTemplateColumns: "280px 1fr", gap: 24 }}>
      <aside>
        <h2>{t("nav.studio")}</h2>
        {drafts.map((draft) => (
          <div
            key={draft.id}
            onClick={() => {
              setActiveDraft(draft.id);
              void loadConversation(draft.id);
            }}
            style={{
              padding: 8,
              marginBottom: 6,
              border: "1px solid #ddd",
              borderRadius: 6,
              cursor: "pointer",
              background: activeDraft === draft.id ? "#eef6ff" : "white",
            }}
          >
            <strong>{draft.name}</strong>
            <div style={{ fontSize: 12, color: "#888" }}>
              {draft.slug} · {draft.version} · {draft.state}
            </div>
          </div>
        ))}
      </aside>
      <section>
        {!activeDraft ? (
          <div style={{ marginBottom: 8 }}>
            <label>应用 slug（kebab-case）：</label>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="my-poster-agent"
              style={{ padding: 8, width: 240 }}
            />
          </div>
        ) : null}
        <div
          style={{
            border: "1px solid #eee",
            borderRadius: 8,
            height: 360,
            overflowY: "auto",
            padding: 12,
            marginBottom: 8,
          }}
        >
          {messages.length === 0 ? (
            <p style={{ color: "#888" }}>描述你想构建的 Agent 应用…</p>
          ) : (
            messages.map((m, i) => (
              <div
                key={i}
                style={{
                  marginBottom: 10,
                  textAlign: m.role === "builder" ? "right" : "left",
                }}
              >
                <div
                  style={{
                    display: "inline-block",
                    padding: "6px 10px",
                    borderRadius: 8,
                    background: m.role === "builder" ? "#0369a1" : "#f1f5f9",
                    color: m.role === "builder" ? "white" : "black",
                    maxWidth: "80%",
                    whiteSpace: "pre-wrap",
                    fontSize: 14,
                  }}
                >
                  {m.text}
                  {m.clarifications?.length ? (
                    <div style={{ marginTop: 4, fontSize: 13, color: "#b45309" }}>
                      ❓ {m.clarifications.join(" / ")}
                    </div>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={{ flex: 1, padding: 8 }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={activeDraft ? "描述修改要求…" : "描述要构建的应用…"}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button onClick={send} disabled={busy}>
            {busy ? "…" : "发送"}
          </button>
        </div>
        {activeDraft ? (
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <button onClick={runTest}>预览测试</button>
            <button onClick={submitForReview}>提交审核</button>
          </div>
        ) : null}
        {error ? <p style={{ color: "#0369a1", fontSize: 13 }}>{error}</p> : null}
      </section>
    </main>
  );
}
