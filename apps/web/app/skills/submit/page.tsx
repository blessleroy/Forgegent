"use client";

import { useState } from "react";
import AppShell from "@/components/app-shell";

/** Employee skill submission (FR-04.2: 投稿 ≠ 安装/运行/授权). */
export default function SubmitSkillPage() {
  const [name, setName] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name || !markdown.trim()) {
      setNotice("名称与 SKILL.md 内容必填");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/skills/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, markdown }),
    });
    setBusy(false);
    if (res.ok) {
      setNotice("投稿成功，等待管理员审核（审核通过前不会进入生产环境）");
      setName("");
      setMarkdown("");
    } else {
      const body = await res.json().catch(() => ({}));
      setNotice(body.error ?? "投稿失败");
    }
  }

  return (
    <AppShell>
      <h1 className="page-title">投稿 Skill</h1>
      <p className="page-sub">
        提交 SKILL.md 内容，管理员审核通过并发布后方可被 Builder 绑定到 Agent 应用。
      </p>
      {notice ? <p style={{ color: "var(--steel)", fontSize: 13, marginBottom: 14 }}>{notice}</p> : null}
      <div className="card" style={{ maxWidth: 620 }}>
        <div className="field">
          <label>Skill 名称（kebab-case）</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="poster-copywriting"
            style={{ fontFamily: "var(--mono)", fontSize: 13 }}
          />
        </div>
        <div className="field">
          <label>SKILL.md 内容</label>
          <textarea
            className="input"
            rows={12}
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            placeholder={"---\nname: poster-copywriting\n---\n# 海报文案技巧\n…"}
            style={{ fontFamily: "var(--mono)", fontSize: 13 }}
          />
          <div className="hint">
            Front-matter 含 name 字段；正文为 Markdown 指令。含可执行脚本会触发更严格审核。
          </div>
        </div>
        <button className="btn btn-primary" onClick={submit} disabled={busy}>
          {busy ? "…" : "提交投稿"}
        </button>
      </div>
    </AppShell>
  );
}
