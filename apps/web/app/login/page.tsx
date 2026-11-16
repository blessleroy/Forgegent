"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale } from "@/lib/use-locale";
import { resetMeCache } from "@/lib/me";

export default function LoginPage() {
  const router = useRouter();
  const { t } = useLocale();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? "邮箱或密码不正确");
        return;
      }
      const data = (await res.json()) as { user?: { mustChangePassword?: boolean } };
      resetMeCache();
      router.push(data.user?.mustChangePassword ? "/change-password" : "/hub");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-hero">
        <div style={{ position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 120 }}>
            <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden>
              <rect x="2" y="2" width="28" height="28" rx="4" fill="#e85d26" />
              <path d="M16 7c-4 0-7 3-7 6.5 0 2.4 1.4 4 3 5v3h8v-3c1.6-1 3-2.6 3-5C23 10 20 7 16 7z" fill="#fff" opacity="0.92" />
              <rect x="12" y="23" width="8" height="2.4" rx="1" fill="#fff" opacity="0.7" />
            </svg>
            <span style={{ fontWeight: 700, fontSize: 18, color: "#fff" }}>Forgegent 智体工坊</span>
          </div>
          <h1>
            用对话锻造 Agent 应用，
            <br />
            像用软件一样交付给全公司。
          </h1>
          <p>
            少数 Builder 在工坊里对话式构建、测试、送审应用；多数员工在应用中心直接使用——
            权限、审计与沙盒隔离由平台保证。
          </p>
        </div>
        <div style={{ position: "relative", fontSize: 12, color: "#7fa0a9" }}>
          Build Agents. Ship Applications.
        </div>
      </div>
      <div className="login-form">
        <form className="login-card" onSubmit={submit}>
          <h2>{t("login.title")}</h2>
          <div className="field">
            <label>{t("login.email")}</label>
            <input
              className="input"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label>{t("login.password")}</label>
            <input
              className="input"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error ? <p className="form-error">{error}</p> : null}
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: "100%", justifyContent: "center", padding: "10px 0" }}>
            {busy ? "…" : t("login.submit")}
          </button>
          <p className="hint" style={{ marginTop: 14 }}>
            首次部署：使用环境变量创建的管理员账号登录，登录后需修改初始密码。
          </p>
        </form>
      </div>
    </div>
  );
}
