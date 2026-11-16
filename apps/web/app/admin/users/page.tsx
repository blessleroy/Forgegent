"use client";

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/app-shell";

interface UserRow {
  id: string;
  email: string;
  name: string;
  status: string;
  roles: string | null;
  departments: string | null;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("employee");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/users");
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(body: Record<string, unknown>) {
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setNotice(res.ok ? "操作成功" : `失败: ${await res.text()}`);
    await load();
  }

  return (
    <AppShell>
      <h1 className="page-title">用户管理</h1>
      <p className="page-sub">创建用户、分配角色、重置密码、停用与部门管理。</p>
      {notice ? <p style={{ color: "var(--steel)", fontSize: 13 }}>{notice}</p> : null}

      <div className="h2">创建用户</div>
      <div className="card" style={{ maxWidth: 560 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input className="input" style={{ flex: 2, minWidth: 160 }} placeholder="邮箱" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="input" style={{ flex: 2, minWidth: 120 }} type="password" placeholder="初始密码（≥8位）" value={password} onChange={(e) => setPassword(e.target.value)} />
          <select className="input" style={{ flex: 1, minWidth: 100 }} value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="employee">员工</option>
            <option value="builder">Builder</option>
            <option value="admin">管理员</option>
          </select>
          <button className="btn btn-primary" onClick={() => { act({ action: "create", email, password, roles: [role] }); setEmail(""); setPassword(""); }}>
            创建
          </button>
        </div>
      </div>

      <div className="h2">全部用户</div>
      <table className="table">
        <thead>
          <tr><th>用户</th><th>角色</th><th>部门</th><th>状态</th><th style={{ width: 260 }}>操作</th></tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>
                <strong>{u.email}</strong>
                {u.name && u.name !== u.email ? <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>{u.name}</div> : null}
              </td>
              <td>{(u.roles ?? "").split(",").filter(Boolean).map((r) => (
                <span key={r} className="badge" style={{ marginRight: 4 }}>{r}</span>
              ))}</td>
              <td style={{ fontSize: 13, color: "var(--ink-soft)" }}>{u.departments ?? "—"}</td>
              <td>
                <span className={`badge ${u.status === "active" ? "s-completed" : "s-cancelled"}`}>{u.status}</span>
              </td>
              <td>
                <button className="btn btn-sm" onClick={() => {
                  const newPass = window.prompt("新密码（≥8位）：") ?? "";
                  if (newPass) act({ action: "reset-password", userId: u.id, password: newPass });
                }}>重置密码</button>{" "}
                {u.status === "active" ? (
                  <button className="btn btn-sm btn-danger" onClick={() => act({ action: "set-status", userId: u.id, status: "disabled" })}>停用</button>
                ) : (
                  <button className="btn btn-sm" onClick={() => act({ action: "set-status", userId: u.id, status: "active" })}>启用</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </AppShell>
  );
}
