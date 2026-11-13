"use client";

import { useCallback, useEffect, useState } from "react";

interface DraftRow {
  draftId: string;
  slug: string;
  name: string;
  state: string;
  builderEmail: string;
  version: string;
  reviewNote: string | null;
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
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/agents/data");
    if (res.ok) {
      const data = (await res.json()) as { drafts: DraftRow[]; agents: AgentRow[] };
      setDrafts(data.drafts);
      setAgents(data.agents);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function review(draftId: string, decision: "approve" | "reject") {
    const note =
      decision === "reject" ? window.prompt("拒绝理由 / rejection note:") ?? "" : undefined;
    const res = await fetch(`/api/admin/drafts/${draftId}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, note }),
    });
    setMessage(res.ok ? `已${decision === "approve" ? "发布" : "拒绝"}` : `失败: ${await res.text()}`);
    await load();
  }

  async function manage(action: string, agentId: string, extra: object = {}) {
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, agentId, ...extra }),
    });
    setMessage(res.ok ? "操作成功" : `失败: ${await res.text()}`);
    await load();
  }

  return (
    <main style={{ maxWidth: 900, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>Agent 管理</h1>
      {message ? <p style={{ color: "#0369a1" }}>{message}</p> : null}

      <h2>待审核草稿</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th align="left">名称</th>
            <th align="left">slug</th>
            <th align="left">版本</th>
            <th align="left">状态</th>
            <th align="left">操作</th>
          </tr>
        </thead>
        <tbody>
          {drafts
            .filter((d) => d.state === "in_review")
            .map((d) => (
              <tr key={d.draftId}>
                <td>{d.name}</td>
                <td>{d.slug}</td>
                <td>{d.version}</td>
                <td>{d.state}</td>
                <td>
                  <button onClick={() => review(d.draftId, "approve")}>发布</button>
                  <button onClick={() => review(d.draftId, "reject")}>拒绝</button>
                </td>
              </tr>
            ))}
          {drafts.filter((d) => d.state === "in_review").length === 0 ? (
            <tr>
              <td colSpan={5} style={{ color: "#888" }}>
                暂无待审核草稿
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <h2>已注册 Agent</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th align="left">名称</th>
            <th align="left">slug</th>
            <th align="left">版本历史</th>
            <th align="left">状态</th>
            <th align="left">操作</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.id}>
              <td>{a.name}</td>
              <td>{a.slug}</td>
              <td>{a.versions.map((v) => v.version).join(", ")}</td>
              <td>{a.listingState}</td>
              <td>
                {a.listingState === "listed" ? (
                  <button onClick={() => manage("delist", a.id)}>下架</button>
                ) : (
                  <span style={{ color: "#888" }}>已下架</span>
                )}
                {a.versions.length > 1 ? (
                  <select
                    onChange={(e) => e.target.value && manage("rollback", a.id, { releaseId: e.target.value })}
                    defaultValue=""
                  >
                    <option value="">回滚到…</option>
                    {a.versions.map((v) => (
                      <option key={v.releaseId} value={v.releaseId}>
                        {v.version}
                      </option>
                    ))}
                  </select>
                ) : null}
                <button
                  onClick={() =>
                    manage("set-grants", a.id, {
                      grants: [{ subjectType: "all_users" }],
                    })
                  }
                >
                  授权全体
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
