"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/use-locale";

export default function HubPage() {
  const { t } = useLocale();
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
    <main style={{ maxWidth: 900, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>{t("hub.title")}</h1>
      <input
        placeholder={t("hub.search")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ padding: 8, width: 300, marginBottom: 16 }}
      />
      {loading ? (
        <p>{t("common.loading")}</p>
      ) : filtered.length === 0 ? (
        <p style={{ color: "#888" }}>{t("hub.empty")}</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          {filtered.map((agent) => (
            <a
              key={agent.id}
              href={`/apps/${agent.slug}`}
              style={{
                display: "block",
                padding: 16,
                border: "1px solid #ddd",
                borderRadius: 8,
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <strong>{agent.name}</strong>
              <p style={{ color: "#666", fontSize: 14 }}>{agent.description}</p>
            </a>
          ))}
        </div>
      )}
    </main>
  );
}
