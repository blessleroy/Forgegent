"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
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
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
          code?: string;
        };
        setError(body.message ?? body.code ?? "登录失败 / Sign-in failed");
        return;
      }
      const data = (await res.json()) as {
        user?: { mustChangePassword?: boolean };
      };
      if (data.user?.mustChangePassword) {
        router.push("/change-password");
      } else {
        router.push("/hub");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      style={{
        maxWidth: 360,
        margin: "8rem auto",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1>Forgegent</h1>
      <form onSubmit={submit}>
        <div style={{ marginBottom: 12 }}>
          <input
            type="email"
            required
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ width: "100%", padding: 8 }}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <input
            type="password"
            required
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ width: "100%", padding: 8 }}
          />
        </div>
        {error ? (
          <p style={{ color: "#c02929", fontSize: 14 }}>{error}</p>
        ) : null}
        <button type="submit" disabled={busy} style={{ padding: "8px 16px" }}>
          {busy ? "..." : "登录 Sign in"}
        </button>
      </form>
    </main>
  );
}
