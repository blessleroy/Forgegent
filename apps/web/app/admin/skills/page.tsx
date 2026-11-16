"use client";

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/app-shell";

interface SubmissionRow {
  id: string;
  reviewState: string;
  reviewNote: string | null;
  submitterEmail: string;
  createdAt: number;
}

interface VersionRow {
  id: string;
  slug: string;
  version: string;
  checksum: string;
  status: string;
}

export default function AdminSkillsPage() {
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/skills");
    if (res.ok) {
      const data = await res.json();
      setSubmissions(data.submissions ?? []);
      setVersions(data.versions ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(body: Record<string, unknown>) {
    const res = await fetch("/api/admin/skills", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setNotice(res.ok ? "操作成功" : `失败: ${await res.text()}`);
    await load();
  }

  const pending = submissions.filter((s) => s.reviewState === "pending");

  return (
    <AppShell>
      <h1 className="page-title">Skill 管理</h1>
      <p className="page-sub">审核投稿、发布版本、撤销与授权绑定。未审核 Skill 永不进入生产加载器（AT-09）。</p>
      {notice ? <p style={{ color: "var(--steel)", fontSize: 13 }}>{notice}</p> : null}

      <div className="h2">待审核投稿（{pending.length}）</div>
      <table className="table">
        <thead>
          <tr><th>投稿人</th><th>状态</th><th>备注</th><th style={{ width: 180 }}>操作</th></tr>
        </thead>
        <tbody>
          {pending.length === 0 ? (
            <tr><td colSpan={4} style={{ color: "var(--ink-faint)" }}>暂无待审核投稿</td></tr>
          ) : (
            pending.map((s) => (
              <tr key={s.id}>
                <td>{s.submitterEmail}</td>
                <td><span className="badge s-pending">{s.reviewState}</span></td>
                <td style={{ fontSize: 13, color: "var(--ink-soft)" }}>{s.reviewNote ?? "—"}</td>
                <td>
                  <button className="btn btn-sm btn-primary" onClick={() =>
                    act({
                      action: "approve",
                      submissionId: s.id,
                      skillName: `skill-${s.id.slice(0, 8)}`,
                      version: "1.0.0",
                      markdown: `---\nname: skill-${s.id.slice(0, 8)}\n---\n待补充内容`,
                    })
                  }>发布</button>{" "}
                  <button className="btn btn-sm btn-danger" onClick={() => {
                    const note = window.prompt("拒绝理由：") ?? "";
                    act({ action: "reject", submissionId: s.id, note });
                  }}>拒绝</button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="h2">已发布版本</div>
      <table className="table">
        <thead>
          <tr><th>Skill</th><th>版本</th><th>状态</th><th style={{ width: 120 }}>操作</th></tr>
        </thead>
        <tbody>
          {versions.length === 0 ? (
            <tr><td colSpan={4} style={{ color: "var(--ink-faint)" }}>暂无已发布版本</td></tr>
          ) : (
            versions.map((v) => (
              <tr key={v.id}>
                <td style={{ fontFamily: "var(--mono)", fontSize: 13 }}>{v.slug}</td>
                <td style={{ fontFamily: "var(--mono)" }}>{v.version}</td>
                <td>
                  <span className={`badge ${v.status === "published" ? "s-completed" : "s-cancelled"}`}>
                    {v.status}
                  </span>
                </td>
                <td>
                  {v.status === "published" ? (
                    <button className="btn btn-sm btn-danger" onClick={() => act({ action: "revoke", skillVersionId: v.id })}>
                      撤销
                    </button>
                  ) : "—"}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </AppShell>
  );
}
