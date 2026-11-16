"use client";

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/app-shell";

interface ResourceRow {
  id: string;
  kind: string;
  name: string;
  config: string | null;
  createdAt: number;
}

export default function AdminResourcesPage() {
  const [resources, setResources] = useState<ResourceRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/resources");
    if (res.ok) {
      const data = await res.json();
      setResources(data.resources ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(body: Record<string, unknown>) {
    const res = await fetch("/api/admin/resources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setNotice(res.ok ? "操作成功" : `失败: ${await res.text()}`);
    await load();
  }

  async function saveEndpoint() {
    if (!baseUrl || !model || !apiKey) {
      setNotice("baseUrl、model、apiKey 均必填");
      return;
    }
    setBusy(true);
    await act({ action: "add-model-endpoint", baseUrl, model, apiKey });
    setBusy(false);
    setApiKey("");
  }

  const hasEndpoint = resources.some((r) => r.kind === "model_endpoint");

  return (
    <AppShell>
      <h1 className="page-title">资源管理</h1>
      <p className="page-sub">模型端点、HTTP API 工具、共享资料。API Key 仅存服务端环境，不落库。</p>
      {notice ? <p style={{ color: "var(--steel)", fontSize: 13 }}>{notice}</p> : null}

      <div className="h2">模型端点（OpenAI 兼容）{hasEndpoint ? <span className="badge s-completed" style={{ marginLeft: 8 }}>已配置</span> : <span className="badge s-pending" style={{ marginLeft: 8 }}>未配置</span>}</div>
      <div className="card" style={{ maxWidth: 560 }}>
        <div className="field">
          <label>Base URL</label>
          <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://gateway.corp.local/v1" style={{ fontFamily: "var(--mono)", fontSize: 13 }} />
        </div>
        <div className="field">
          <label>模型 ID</label>
          <input className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-image-1 / qwen-max / ..." style={{ fontFamily: "var(--mono)", fontSize: 13 }} />
        </div>
        <div className="field">
          <label>API Key（仅验证与运行时环境引用，不入库）</label>
          <input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </div>
        <button className="btn btn-primary" onClick={saveEndpoint} disabled={busy}>
          {busy ? "探活中…" : "保存并探活"}
        </button>
      </div>

      <div className="h2">已注册资源</div>
      <table className="table">
        <thead>
          <tr><th>类型</th><th>名称</th><th>配置</th><th style={{ width: 80 }} /></tr>
        </thead>
        <tbody>
          {resources.length === 0 ? (
            <tr><td colSpan={4} style={{ color: "var(--ink-faint)" }}>暂无资源</td></tr>
          ) : (
            resources.map((r) => (
              <tr key={r.id}>
                <td><span className="badge">{r.kind}</span></td>
                <td>{r.name}</td>
                <td style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-soft)", maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {(() => {
                    try {
                      const c = JSON.parse(r.config ?? "{}");
                      return JSON.stringify({ ...c, apiKey: c.apiKey ? "[env]" : undefined });
                    } catch { return r.config ?? "—"; }
                  })()}
                </td>
                <td>
                  <button className="btn btn-sm btn-danger" onClick={() => act({ action: "delete", resourceId: r.id })}>删除</button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </AppShell>
  );
}
