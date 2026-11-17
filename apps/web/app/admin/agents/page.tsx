"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import AppShell from "@/components/app-shell";
import { useLocale } from "@/lib/use-locale";

interface GateResult {
  passed?: boolean;
  failures?: string[];
  summary?: string;
  asyncTestTaskId?: string;
  offline?: boolean;
}

interface DraftRow {
  draftId: string;
  slug: string;
  name: string;
  state: string;
  builderEmail: string;
  version: string;
  reviewNote: string | null;
  autoTestResult: string | null;
  payload: string;
}

interface GrantRow {
  subjectType: string;
  subjectId: string | null;
  subjectLabel: string | null;
}

interface AgentRow {
  id: string;
  slug: string;
  name: string;
  activeReleaseId: string | null;
  listingState: string;
  categoryId: string | null;
  versions: { version: string; releaseId: string }[];
  grants: GrantRow[];
}

interface Payload {
  prompts?: { system?: string };
  toolRefs?: string[];
  resourceRefs?: string[];
  usage?: string;
  embeddedSkills?: { id: string; name: string; markdown: string }[];
}

/** Admin agent governance — review materials (incl. embedded skills, D46),
 *  per-user/department grants (R4.1), categories (N9), lifecycle. */
export default function AdminAgentsPage() {
  const { locale } = useLocale();
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [candidates, setCandidates] = useState<{
    users: { id: string; email: string }[];
    departments: { id: string; name: string }[];
  }>({ users: [], departments: [] });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [grantPanel, setGrantPanel] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/agents/data");
    if (res.ok) {
      const data = await res.json();
      setDrafts(data.drafts ?? []);
      setAgents(data.agents ?? []);
      setCategories(data.categories ?? []);
      setCandidates(data.grantCandidates ?? { users: [], departments: [] });
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
    const data = await res.json().catch(() => ({}));
    setMessage(res.ok ? (locale === "zh" ? "操作成功" : "Done") : `失败: ${await res.text()}`);
    await load();
    return data as { categoryId?: string };
  }

  async function exportLatest(agentId: string) {
    const agent = agents.find((a) => a.id === agentId);
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

  function grantLabel(g: GrantRow): string {
    if (g.subjectType === "all_users") return zh ? "全体员工" : "Everyone";
    return `${g.subjectType === "user" ? "" : zh ? "部门:" : "Dept: "}${g.subjectLabel ?? g.subjectId?.slice(0, 8) ?? ""}`;
  }

  return (
    <AppShell>
      <h1 className="page-title">{zh ? "Agent 管理" : "Agent Governance"}</h1>
      <p className="page-sub">
        {zh
          ? "审核发布（含内嵌 Skill 连带审核）、上下架、版本回滚、成员/部门授权、分类与导入导出。"
          : "Review & publish (incl. embedded skills), delist, roll back, per-user/department grants, categories, import & export."}
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
            <th style={{ width: 210 }}>{zh ? "操作" : "Actions"}</th>
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
              let gate: GateResult | null = null;
              let payload: Payload = {};
              try {
                gate = d.autoTestResult ? (JSON.parse(d.autoTestResult) as GateResult) : null;
              } catch {
                gate = null;
              }
              try {
                payload = JSON.parse(d.payload) as Payload;
              } catch {
                payload = {};
              }
              return (
                <Fragment key={d.draftId}>
                  <tr>
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
                          {gate.passed
                            ? zh ? "通过" : "pass"
                            : `${gate.failures?.length ?? 0} ${zh ? "项失败" : "failures"}`}
                        </span>
                      ) : (
                        <span style={{ color: "var(--ink-faint)" }}>—</span>
                      )}
                    </td>
                    <td>
                      <button
                        className="btn btn-sm"
                        onClick={() => setExpanded(expanded === d.draftId ? null : d.draftId)}
                      >
                        {expanded === d.draftId ? (zh ? "收起材料" : "Hide") : zh ? "审核材料" : "Materials"}
                      </button>{" "}
                      <button className="btn btn-sm btn-primary" onClick={() => review(d.draftId, "approve")}>
                        {zh ? "发布" : "Publish"}
                      </button>{" "}
                      <button className="btn btn-sm btn-danger" onClick={() => review(d.draftId, "reject")}>
                        {zh ? "拒绝" : "Reject"}
                      </button>
                    </td>
                  </tr>
                  {expanded === d.draftId ? (
                    <tr>
                      <td colSpan={5} style={{ background: "var(--paper-soft, #fafafa)" }}>
                        <div style={{ fontSize: 13, lineHeight: 1.9 }}>
                          <div><strong>{zh ? "系统提示词" : "System prompt"}：</strong>
                            <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "#fff", padding: 8, borderRadius: 6 }}>
                              {payload.prompts?.system?.slice(0, 1200) ?? "—"}
                            </pre>
                          </div>
                          <div><strong>{zh ? "工具绑定" : "Tools"}：</strong>{payload.toolRefs?.join("、") || "—"}</div>
                          <div><strong>{zh ? "资源引用" : "Resources"}：</strong>{payload.resourceRefs?.join("、") || "—"}</div>
                          <div><strong>{zh ? "使用说明" : "Usage"}：</strong>{payload.usage || "—"}</div>
                          <div><strong>{zh ? "自动测试" : "Gate"}：</strong>{gate?.summary ?? "—"}
                            {gate?.asyncTestTaskId ? (
                              <a style={{ marginLeft: 8 }} href={`/tasks/${gate.asyncTestTaskId}`}>[{zh ? "隔离测试任务" : "test task"}]</a>
                            ) : null}
                          </div>
                          {(payload.embeddedSkills ?? []).length > 0 ? (
                            <div>
                              <strong>{zh ? "内嵌 Skill（将随发布连带入库，D46）" : "Embedded skills (published with approval)"}：</strong>
                              {(payload.embeddedSkills ?? []).map((skill) => (
                                <details key={skill.id} style={{ marginTop: 6 }}>
                                  <summary style={{ cursor: "pointer", fontFamily: "var(--mono)", fontSize: 12 }}>
                                    {skill.id} — {skill.name}
                                  </summary>
                                  <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "#fff", padding: 8, borderRadius: 6, maxHeight: 260, overflow: "auto" }}>
                                    {skill.markdown}
                                  </pre>
                                </details>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>

      {drafts.some((d) => d.state === "editing" && d.reviewNote) ? (
        <>
          <div className="h2">{zh ? "最近拒绝理由（退回草稿）" : "Recent rejection notes"}</div>
          <div className="card" style={{ padding: 12 }}>
            {drafts
              .filter((d) => d.state === "editing" && d.reviewNote)
              .slice(0, 5)
              .map((d) => (
                <div key={d.draftId} style={{ fontSize: 13, padding: "4px 0", borderBottom: "1px solid #f0f0f0" }}>
                  <strong>{d.name}</strong> <span style={{ color: "var(--ink-soft)" }}>— {d.reviewNote}</span>
                </div>
              ))}
          </div>
        </>
      ) : null}

      <div className="h2">{zh ? "已注册应用" : "Registered apps"}</div>
      <table className="table">
        <thead>
          <tr>
            <th>{zh ? "应用" : "App"}</th>
            <th>{zh ? "版本历史" : "Versions"}</th>
            <th>{zh ? "授权范围" : "Grants"}</th>
            <th>{zh ? "分类" : "Category"}</th>
            <th style={{ width: 320 }}>{zh ? "操作" : "Actions"}</th>
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
              <td style={{ fontSize: 12 }}>
                {a.grants.length === 0 ? (
                  <span style={{ color: "var(--ink-faint)" }}>{zh ? "未授权（仅 Admin）" : "None (admin-only)"}</span>
                ) : (
                  a.grants.map((g, i) => (
                    <span key={i} className="badge s-pending" style={{ fontSize: 11, marginRight: 4 }}>
                      {grantLabel(g)}
                    </span>
                  ))
                )}
              </td>
              <td>
                <select
                  className="btn btn-sm"
                  defaultValue={a.categoryId ?? ""}
                  onChange={(e) => void manage("set-category", a.id, { categoryId: e.target.value || null })}
                  style={{ font: "inherit", fontSize: 12 }}
                >
                  <option value="">{zh ? "未分类" : "—"}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
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
                <button className="btn btn-sm" onClick={() => setGrantPanel(grantPanel === a.id ? null : a.id)}>
                  {zh ? "授权…" : "Grants…"}
                </button>{" "}
                <button className="btn btn-sm" onClick={() => exportLatest(a.id)}>
                  {zh ? "导出" : "Export"}
                </button>
                {grantPanel === a.id ? (
                  <div className="card" style={{ padding: 10, marginTop: 8, fontSize: 13 }}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button className="btn btn-sm" onClick={() => manage("set-grants", a.id, { grants: [{ subjectType: "all_users" }] })}>
                        {zh ? "授权全体" : "Everyone"}
                      </button>
                      <select
                        className="btn btn-sm"
                        defaultValue=""
                        onChange={(e) => {
                          const id = e.target.value;
                          if (!id) return;
                          const grants = [
                            ...a.grants
                              .filter((g) => g.subjectType !== "all_users")
                              .map((g) => ({ subjectType: g.subjectType, subjectId: g.subjectId ?? undefined })),
                            { subjectType: "user", subjectId: id },
                          ];
                          void manage("set-grants", a.id, { grants });
                        }}
                        style={{ font: "inherit", fontSize: 12 }}
                      >
                        <option value="">+ {zh ? "添加成员…" : "+ Add user…"}</option>
                        {candidates.users.map((u) => (
                          <option key={u.id} value={u.id}>{u.email}</option>
                        ))}
                      </select>
                      <select
                        className="btn btn-sm"
                        defaultValue=""
                        onChange={(e) => {
                          const id = e.target.value;
                          if (!id) return;
                          const grants = [
                            ...a.grants
                              .filter((g) => g.subjectType !== "all_users")
                              .map((g) => ({ subjectType: g.subjectType, subjectId: g.subjectId ?? undefined })),
                            { subjectType: "department", subjectId: id },
                          ];
                          void manage("set-grants", a.id, { grants });
                        }}
                        style={{ font: "inherit", fontSize: 12 }}
                      >
                        <option value="">+ {zh ? "添加部门…" : "+ Add department…"}</option>
                        {candidates.departments.map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => manage("set-grants", a.id, { grants: [] })}
                      >
                        {zh ? "清空授权（仅 Admin 可见）" : "Clear (admin-only)"}
                      </button>
                      <button
                        className="btn btn-sm"
                        onClick={async () => {
                          const name = window.prompt(zh ? "新分类名称：" : "New category name:");
                          if (!name) return;
                          await manage("create-category", a.id, { categoryName: name });
                        }}
                      >
                        {zh ? "新建分类…" : "New category…"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </AppShell>
  );
}
