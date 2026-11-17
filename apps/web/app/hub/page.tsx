"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/app-shell";
import { useLocale } from "@/lib/use-locale";

interface HubAgent {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string | null;
}

/** Hub — authorized apps with search + category filter (N9: admin-assigned
 *  categories, unassigned apps fall into 未分类). */
export default function HubPage() {
  const { t, locale } = useLocale();
  const [agents, setAgents] = useState<HubAgent[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/agents")
      .then((res) => (res.ok ? res.json() : { agents: [] }))
      .then((data) => setAgents(data.agents ?? []))
      .finally(() => setLoading(false));
  }, []);

  const categories = [
    ...new Set(agents.map((a) => a.category ?? "未分类")),
  ].sort();
  const unclassified = locale === "zh" ? "未分类" : "Uncategorized";

  const filtered = agents.filter(
    (a) =>
      (!query ||
        a.name.toLowerCase().includes(query.toLowerCase()) ||
        a.slug.includes(query.toLowerCase())) &&
      (!category || (a.category ?? unclassified) === category),
  );

  return (
    <AppShell>
      <h1 className="page-title">{t("hub.title")}</h1>
      <p className="page-sub">
        {locale === "zh"
          ? "选择一个应用开始工作；这里只显示管理员授权给你的应用。"
          : "Pick an app to start — only apps granted to you are listed."}
      </p>
      <div style={{ display: "flex", gap: 8, maxWidth: 560, marginBottom: 8, flexWrap: "wrap" }}>
        <div className="field" style={{ maxWidth: 300, margin: 0 }}>
          <input
            className="input"
            placeholder={t("hub.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          className="input"
          style={{ maxWidth: 160 }}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">{locale === "zh" ? "全部分类" : "All categories"}</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
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
              {agent.category ? (
                <div style={{ marginTop: 8 }}>
                  <span className="badge s-pending" style={{ fontSize: 11 }}>{agent.category}</span>
                </div>
              ) : null}
            </a>
          ))}
        </div>
      )}
    </AppShell>
  );
}
