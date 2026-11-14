"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AppShell from "@/components/app-shell";
import { TASK_STATE_LABELS } from "@/lib/i18n";
import { useLocale } from "@/lib/use-locale";

interface TaskRow {
  id: string;
  state: string;
  inputSummary: string | null;
}

export default function TasksPage() {
  const { t, locale } = useLocale();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = () =>
      fetch("/api/tasks")
        .then((res) => (res.ok ? res.json() : { tasks: [] }))
        .then((data) => setTasks(data.tasks ?? []))
        .finally(() => setLoading(false));
    void load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, []);

  return (
    <AppShell>
      <h1 className="page-title">{t("tasks.title")}</h1>
      <p className="page-sub">
        {locale === "zh"
          ? "页面关闭不影响执行中的任务；随时回来查看进度与成果。"
          : "Tasks keep running with the page closed — come back any time."}
      </p>
      {loading ? (
        <p style={{ color: "var(--ink-faint)" }}>{t("common.loading")}</p>
      ) : tasks.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "48px 24px" }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{t("tasks.empty")}</div>
          <p style={{ color: "var(--ink-soft)", fontSize: 13, margin: 0 }}>
            {locale === "zh" ? "去应用中心发起第一个任务。" : "Start your first task from the Hub."}
          </p>
          <Link href="/hub" className="btn btn-primary" style={{ marginTop: 16 }}>
            {t("nav.hub")}
          </Link>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{locale === "zh" ? "任务" : "Task"}</th>
              <th style={{ width: 160 }}>{t("task.state")}</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id}>
                <td>
                  <Link href={`/tasks/${task.id}`}>
                    {(task.inputSummary ?? "").split("\n")[0]?.slice(0, 70) || task.id}
                  </Link>
                </td>
                <td>
                  <span className={`badge s-${task.state}`}>
                    {TASK_STATE_LABELS[locale][task.state] ?? task.state}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </AppShell>
  );
}
