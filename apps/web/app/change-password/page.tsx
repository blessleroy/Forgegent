"use client";

import { useState } from "react";
import { useLocale } from "@/lib/use-locale";

/** Forced first-login password change (D14). */
export default function ChangePasswordPage() {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next.length < 8) {
      setError(zh ? "新密码至少 8 位" : "New password needs 8+ characters");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    });
    setBusy(false);
    if (res.ok) {
      window.location.href = "/hub";
    } else {
      setError(zh ? "当前密码不正确，或新密码不合规" : "Current password wrong or new password invalid");
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-hero">
        <div style={{ position: "relative", maxWidth: 480 }}>
          <h1 style={{ fontSize: 26 }}>
            {zh ? "首次登录，请修改初始密码" : "Change your initial password"}
          </h1>
          <p>
            {zh
              ? "初始密码来自部署环境变量，为保障账号安全，修改后才能进入平台。"
              : "The initial password came from deployment env; change it to continue."}
          </p>
        </div>
      </div>
      <div className="login-form">
        <form className="login-card" onSubmit={submit}>
          <h2>{zh ? "修改密码" : "Change password"}</h2>
          <div className="field">
            <label>{zh ? "当前（初始）密码" : "Current password"}</label>
            <input
              className="input"
              type="password"
              required
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
          <div className="field">
            <label>{zh ? "新密码（≥8 位）" : "New password (8+)"}</label>
            <input
              className="input"
              type="password"
              required
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </div>
          {error ? <p className="form-error">{error}</p> : null}
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: "100%", justifyContent: "center", padding: "10px 0" }}>
            {busy ? "…" : zh ? "确认修改" : "Save"}
          </button>
        </form>
      </div>
    </div>
  );
}
