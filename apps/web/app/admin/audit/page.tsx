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

interface FailureRow {
  taskId: string;
  safePayload: { errorType?: string; reason?: string } | null;
  createdAt: number;
  taskState: string;
}

interface DenyStats {
  last24h: number;
  byAction: { action: string; count: number }[];
}

/** Admin audit page — R4.4 adds the action filter, run-failure query and
 *  the 24h deny aggregate (运行失败/拒绝操作数, PRD §4 + §11.3). */
export default function AdminAuditPage() {
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [failures, setFailures] = useState<FailureRow[]>([]);
  const [denyStats, setDenyStats] = useState<DenyStats | null>(null);
  const [decision, setDecision] = useState("");
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [showFailures, setShowFailures] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (decision) params.set("decision", decision);
    if (actor) params.set("actor", actor);
    if (action) params.set("action", action);
    if (showFailures) params.set("failures", "1");
    params.set("denyStats", "1");
    const res = await fetch(`/api/admin/audit?${params}`);
    if (res.ok) {
      const data = await res.json();
      setLogs(data.logs ?? []);
      setFailures(data.failures ?? []);
      setDenyStats(data.denyStats ?? null);
    }
    setLoading(false);
  }, [decision, actor, action, showFailures]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AppShell>
      <h1 className="page-title">审计日志</h1>
      <p className="page-sub">权限拒绝、发布、审核、敏感操作、运行失败留痕；不含任何秘密值（FR-09.7）。</p>

      {denyStats ? (
        <div className="card" style={{ padding: "8px 12px", marginBottom: 14, fontSize: 13 }}>
          最近 24h 拒绝操作数：<strong>{denyStats.last24h}</strong>
          {denyStats.byAction.length > 0 ? (
            <span style={{ color: "var(--ink-soft)" }}>
              {" "}（{denyStats.byAction.map((d) => `${d.action}×${d.count}`).join("、")}）
            </span>
          ) : null}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, marginBottom: 14, maxWidth: 720, flexWrap: "wrap" }}>
        <select className="input" style={{ maxWidth: 110 }} value={decision} onChange={(e) => setDecision(e.target.value)}>
          <option value="">全部</option>
          <option value="deny">拒绝</option>
          <option value="allow">允许</option>
        </select>
        <input className="input" style={{ maxWidth: 180 }} placeholder="按操作者邮箱过滤…" value={actor} onChange={(e) => setActor(e.target.value)} />
        <input className="input" style={{ maxWidth: 180 }} placeholder="按动作过滤（如 run.failed）…" value={action} onChange={(e) => setAction(e.target.value)} />
        <button
          className={`btn btn-sm${showFailures ? " btn-primary" : ""}`}
          onClick={() => setShowFailures(!showFailures)}
        >
          运行失败查询
        </button>
      </div>

      {showFailures ? (
        <div className="card" style={{ padding: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>最近运行失败（run.failed）</div>
          {failures.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--ink-faint)" }}>无失败记录</div>
          ) : (
            failures.map((f, i) => (
              <div key={i} style={{ fontSize: 12, padding: "4px 0", borderBottom: "1px solid #f0f0f0" }}>
                <span style={{ fontFamily: "var(--mono)" }}>{f.taskId.slice(0, 8)}</span>{" "}
                <span className={`badge s-${f.taskState}`} style={{ fontSize: 11 }}>{f.taskState}</span>{" "}
                <span style={{ color: "var(--ink-soft)" }}>
                  {f.safePayload?.errorType ?? ""} {String(f.safePayload?.reason ?? "").slice(0, 120)}
                </span>
              </div>
            ))
          )}
        </div>
      ) : null}

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
