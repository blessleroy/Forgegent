"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { getMe, resetMeCache, type Me } from "@/lib/me";
import { useLocale } from "@/lib/use-locale";

function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    hub: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    tasks: <path d="M4 6h16M4 12h16M4 18h10" />,
    files: <><path d="M13 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9l-6-6z" /><path d="M13 3v6h6" /></>,
    studio: <path d="M12 3l3 6 6 1-4.5 4.2L18 21l-6-3.4L6 21l1.5-6.8L3 10l6-1z" />,
    admin: <><circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" /></>,
  };
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

/**
 * App shell: workshop side navigation (steel + molten active edge).
 * Wraps every authenticated page.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { locale, setLocale, t } = useLocale();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    void getMe().then(setMe);
  }, []);

  async function signOut() {
    await fetch("/api/auth/sign-out", { method: "POST" });
    resetMeCache();
    window.location.href = "/login";
  }

  const isBuilder = me?.roles.includes("builder") ?? false;
  const isAdmin = me?.roles.includes("admin") ?? false;

  const navItems: { href: string; label?: string; key?: "nav.hub" | "nav.tasks" | "nav.files" | "nav.studio" | "nav.admin"; icon: string; show: boolean }[] = [
    { href: "/hub", key: "nav.hub" as const, icon: "hub", show: true },
    { href: "/tasks", key: "nav.tasks" as const, icon: "tasks", show: true },
    { href: "/files", key: "nav.files" as const, icon: "files", show: true },
    { href: "/skills/submit", label: "投稿 Skill", icon: "studio", show: true },
    { href: "/studio", key: "nav.studio" as const, icon: "studio", show: isBuilder },
    { href: "/admin/agents", key: "nav.admin" as const, icon: "admin", show: isAdmin },
    { href: "/admin/skills", label: "Skills", icon: "admin", show: isAdmin },
    { href: "/admin/resources", label: "Resources", icon: "admin", show: isAdmin },
    { href: "/admin/users", label: "Users", icon: "admin", show: isAdmin },
    { href: "/admin/audit", label: "Audit", icon: "admin", show: isAdmin },
  ];

  return (
    <div className="shell">
      <aside className="shell-side">
        <div className="shell-brand">
          <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
            <rect x="2" y="2" width="28" height="28" rx="4" fill="#e85d26" />
            <path d="M16 7c-4 0-7 3-7 6.5 0 2.4 1.4 4 3 5v3h8v-3c1.6-1 3-2.6 3-5C23 10 20 7 16 7z" fill="#fff" opacity="0.92" />
            <rect x="12" y="23" width="8" height="2.4" rx="1" fill="#fff" opacity="0.7" />
          </svg>
          <div>
            <div className="t1">智体工坊</div>
            <div className="t2">Forgegent</div>
          </div>
        </div>
        <nav className="nav">
          <div className="nav-section">{locale === "zh" ? "工作台" : "WORKSPACE"}</div>
          {navItems.filter((i) => i.show).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={pathname.startsWith(item.href) ? "active" : ""}
            >
              <Icon name={item.icon} />
              {item.label ?? t(item.key)}
            </Link>
          ))}
        </nav>
        <div className="shell-foot">
          <div className="shell-user" title={me?.email ?? ""}>
            {me?.email ?? "…"}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div className="shell-locale">
              <button className={locale === "zh" ? "on" : ""} onClick={() => setLocale("zh")}>中</button>
              <button className={locale === "en" ? "on" : ""} onClick={() => setLocale("en")}>EN</button>
            </div>
            <button
              onClick={signOut}
              className="shell-locale"
              style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.22)", borderRadius: 3, padding: "2px 8px", color: "#9db6bd", cursor: "pointer", font: "inherit", fontSize: 12 }}
            >
              {t("nav.logout")}
            </button>
          </div>
        </div>
      </aside>
      <main className="shell-main">
        <div className="shell-body">{children}</div>
      </main>
    </div>
  );
}
