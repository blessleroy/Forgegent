"use client";

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/app-shell";
import { useLocale } from "@/lib/use-locale";

interface DraftRow {
  draftId: string;
  slug: string;
  name: string;
  state: string;
  builderEmail: string;
  version: string;
  reviewNote: string | null;
  autoTestResult: string | null;
}

interface AgentRow {
  id: string;
  slug: string;
  name: string;
  activeReleaseId: string | null;
  listingState: string;
  versions: { version: string; releaseId: string }[];
}

export default function AdminAgentsPage() {
  const { locale } = useLocale();
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/agents/data");
    if (res.ok) {
      const data = await res.json();
      setDrafts(data.drafts ?? []);
      setAgents(data.agents ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function review(draftId: string, decision: "approve" | "reject") {
    const note =
      decision === "reject"
        ? window.prompt(locale === "zh" ? "拒绝理由：" : "Rejection note:") ?? ""
        : undefined;
    const res = await fetch(`/api/admin/drafts/${draftId}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, note }),
    });
    setMessage(
      res.ok
        ? decision === "approve"
          ? locale === "zh" ? "已发布" : "Published"
          : locale === "zh" ? "已拒绝并退回" : "Rejected"
        : `失败: ${await res.text()}`,
    );
    await load();
  }

  async function manage(action: string, agentId: string, extra: object = {}) {
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, agentId, ...extra }),
    });
    setMessage(res.ok ? (locale === "zh" ? "操作成功" : "Done") : `失败: ${await res.text()}`);
    await load();
  }

  async function exportLatest(agentId: string) {
    const data = await (await fetch("/api/admin/agents/data")).json();
    const agent = (data.agents as AgentRow[]).find((a) => a.id === agentId);
    const latest = agent?.versions.at(-1);
    if (!latest) return;
    window.open(`/api/admin/releases/${latest.releaseId}/export`, "_blank");
  }

  async function importBundle() {
    const bundleJson = window.prompt(locale === "zh" ? "粘贴导出的 bundle JSON：" : "Paste bundle JSON:");
    if (!bundleJson) return;
    const slug = window.prompt(locale === "zh" ? "新应用 slug（kebab-case）：" : "New slug:");
    if (!slug) return;
    const res = await fetch("/api/admin/releases/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bundleJson, slug }),
    });
    setMessage(
      res.ok
        ? locale === "zh" ? "已导入为草稿（需重新授权与审核）" : "Imported as draft"
        : `失败: ${await res.text()}`,
    );
    await load();
  }

  const pending = drafts.filter((d) => d.state === "in_review");
  const zh = locale === "zh";

  return (
    <AppShell>
      <h1 className="page-title">{zh ? "Agent 管理" : "Agent Governance"}</h1>
      <p className="page-sub">
        {zh
          ? "审核发布、上下架、版本回滚、授权与导入导出。"
          : "Review, publish, delist, roll back, grant, import & export."}
        <button className="btn btn-sm" style={{ marginLeft: 12 }} onClick={importBundle}>
          {zh ? "导入应用包" : "Import bundle"}
        </button>
      </p>
      {message ? <p style={{ color: "var(--steel)", fontSize: 13 }}>{message}</p> : null}

      <div className="h2">{zh ? `待审核草稿（${pending.length}）` : `Pending review (${pending.length})`}</div>
      <table className="table">
        <thead>
          <tr>
            <th>{zh ? "应用" : "App"}</th>
            <th>{zh ? "版本" : "Version"}</th>
            <th>Builder</th>
            <th>{zh ? "自动测试" : "Auto tests"}</th>
            <th style={{ width: 150 }}>{zh ? "操作" : "Actions"}</th>
          </tr>
        </thead>
        <tbody>
          {pending.length === 0 ? (
            <tr>
              <td colSpan={5} style={{ color: "var(--ink-faint)" }}>
                {zh ? "暂无待审核草稿" : "Nothing pending"}
              </td>
            </tr>
          ) : (
            pending.map((d) => {
              let gate: { passed?: boolean; failures?: string[] } | null = null;
              try {
                gate = d.autoTestResult ? JSON.parse(d.autoTestResult) : null;
              } catch {
                gate = null;
              }
              return (
                <tr key={d.draftId}>
                  <td>
                    <strong>{d.name}</strong>
                    <div style={{ fontSize: 12, color: "var(--ink-soft)", fontFamily: "var(--mono)" }}>
                      {d.slug}
                    </div>
                  </td>
                  <td style={{ fontFamily: "var(--mono)" }}>{d.version}</td>
                  <td style={{ fontSize: 13, color: "var(--ink-soft)" }}>{d.builderEmail}</td>
                  <td>
                    {gate ? (
                      <span className={`badge ${gate.passed ? "s-completed" : "s-failed"}`}>
                        {gate.passed ? (zh ? "通过" : "pass") : `${gate.failures?.length ?? 0} ${zh ? "项失败" : "failures"}`}
                      </span>
                    ) : (
                      <span style={{ color: "var(--ink-faint)" }}>—</span>
                    )}
                  </td>
                  <td>
                    <button className="btn btn-sm btn-primary" onClick={() => review(d.draftId, "approve")}>
                      {zh ? "发布" : "Publish"}
                    </button>{" "}
                    <button className="btn btn-sm btn-danger" onClick={() => review(d.draftId, "reject")}>
                      {zh ? "拒绝" : "Reject"}
                    </button>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      <div className="h2">{zh ? "已注册应用" : "Registered apps"}</div>
      <table className="table">
        <thead>
          <tr>
            <th>{zh ? "应用" : "App"}</th>
            <th>{zh ? "版本历史" : "Versions"}</th>
            <th>{zh ? "状态" : "Status"}</th>
            <th style={{ width: 300 }}>{zh ? "操作" : "Actions"}</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.id}>
              <td>
                <strong>{a.name}</strong>
                <div style={{ fontSize: 12, color: "var(--ink-soft)", fontFamily: "var(--mono)" }}>
                  {a.slug}
                </div>
              </td>
              <td style={{ fontFamily: "var(--mono)", fontSize: 13 }}>
                {a.versions.map((v) => v.version).join(" · ") || "—"}
              </td>
              <td>
                <span className={`badge ${a.listingState === "listed" ? "s-completed" : "s-cancelled"}`}>
                  {a.listingState}
                </span>
              </td>
              <td>
                {a.listingState === "listed" ? (
                  <button className="btn btn-sm" onClick={() => manage("delist", a.id)}>
                    {zh ? "下架" : "Delist"}
                  </button>
                ) : null}{" "}
                {a.versions.length > 1 ? (
                  <select
                    className="btn btn-sm"
                    defaultValue=""
                    onChange={(e) => e.target.value && manage("rollback", a.id, { releaseId: e.target.value })}
                    style={{ font: "inherit", fontSize: 13 }}
                  >
                    <option value="">{zh ? "回滚到…" : "Roll back to…"}</option>
                    {a.versions.map((v) => (
                      <option key={v.releaseId} value={v.releaseId}>
                        {v.version}
                      </option>
                    ))}
                  </select>
                ) : null}{" "}
                <button className="btn btn-sm" onClick={() => manage("set-grants", a.id, { grants: [{ subjectType: "all_users" }] })}>
                  {zh ? "授权全体" : "Grant all"}
                </button>{" "}
                <button className="btn btn-sm" onClick={() => exportLatest(a.id)}>
                  {zh ? "导出" : "Export"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </AppShell>
  );
}
