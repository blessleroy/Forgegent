"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/app-shell";
import { useLocale } from "@/lib/use-locale";

export default function HubPage() {
  const { t, locale } = useLocale();
  const [agents, setAgents] = useState<
    { id: string; slug: string; name: string; description: string }[]
  >([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/agents")
      .then((res) => (res.ok ? res.json() : { agents: [] }))
      .then((data) => setAgents(data.agents ?? []))
      .finally(() => setLoading(false));
  }, []);

  const filtered = agents.filter(
    (a) =>
      !query ||
      a.name.toLowerCase().includes(query.toLowerCase()) ||
      a.slug.includes(query.toLowerCase()),
  );

  return (
    <AppShell>
      <h1 className="page-title">{t("hub.title")}</h1>
      <p className="page-sub">
        {locale === "zh"
          ? "选择一个应用开始工作；这里只显示管理员授权给你的应用。"
          : "Pick an app to start — only apps granted to you are listed."}
      </p>
      <div className="field" style={{ maxWidth: 340 }}>
        <input
          className="input"
          placeholder={t("hub.search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {loading ? (
        <p style={{ color: "var(--ink-faint)" }}>{t("common.loading")}</p>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "48px 24px" }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{t("hub.empty")}</div>
          <p style={{ color: "var(--ink-soft)", fontSize: 13, margin: 0 }}>
            {locale === "zh"
              ? "应用由 Builder 构建并经管理员审核发布后，会出现在这里。"
              : "Apps appear here after a builder publishes them through review."}
          </p>
        </div>
      ) : (
        <div className="grid-cards">
          {filtered.map((agent) => (
            <a key={agent.id} className="app-card" href={`/apps/${agent.slug}`}>
              <div className="glyph">{agent.name.slice(0, 1)}</div>
              <div className="name">{agent.name}</div>
              <div className="desc">{agent.description}</div>
            </a>
          ))}
        </div>
      )}
    </AppShell>
  );
}
