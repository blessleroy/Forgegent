"use client";

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/app-shell";

interface AuditRow {
  id: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  decision: string;
  reason: string | null;
  createdAt: number;
  actorEmail: string | null;
}

export default function AdminAuditPage() {
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [decision, setDecision] = useState("");
  const [actor, setActor] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (decision) params.set("decision", decision);
    if (actor) params.set("actor", actor);
    const res = await fetch(`/api/admin/audit?${params}`);
    if (res.ok) {
      const data = await res.json();
      setLogs(data.logs ?? []);
    }
    setLoading(false);
  }, [decision, actor]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AppShell>
      <h1 className="page-title">审计日志</h1>
      <p className="page-sub">权限拒绝、发布、审核、敏感操作留痕；不含任何秘密值（FR-09.7）。</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, maxWidth: 500 }}>
        <select className="input" style={{ maxWidth: 120 }} value={decision} onChange={(e) => setDecision(e.target.value)}>
          <option value="">全部</option>
          <option value="deny">拒绝</option>
          <option value="allow">允许</option>
        </select>
        <input className="input" placeholder="按操作者邮箱过滤…" value={actor} onChange={(e) => setActor(e.target.value)} />
      </div>
      {loading ? (
        <p style={{ color: "var(--ink-faint)" }}>加载中…</p>
      ) : (
        <table className="table">
          <thead>
            <tr><th>时间</th><th>操作者</th><th>动作</th><th>决定</th><th>资源</th><th>原因</th></tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr><td colSpan={6} style={{ color: "var(--ink-faint)" }}>无匹配记录</td></tr>
            ) : (
              logs.map((l) => (
                <tr key={l.id}>
                  <td style={{ fontFamily: "var(--mono)", fontSize: 12, whiteSpace: "nowrap" }}>
                    {new Date(l.createdAt).toLocaleString("zh-CN")}
                  </td>
                  <td style={{ fontSize: 13 }}>{l.actorEmail ?? "—"}</td>
                  <td style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{l.action}</td>
                  <td>
                    <span className={`badge ${l.decision === "allow" ? "s-completed" : "s-failed"}`}>{l.decision}</span>
                  </td>
                  <td style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-soft)" }}>
                    {l.resourceType ? `${l.resourceType}:${(l.resourceId ?? "").slice(0, 8)}` : "—"}
                  </td>
                  <td style={{ fontSize: 12, color: "var(--ink-soft)", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {l.reason ?? "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </AppShell>
  );
}
