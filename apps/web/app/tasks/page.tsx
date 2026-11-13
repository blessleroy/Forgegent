"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TASK_STATE_LABELS, localeFromCookie } from "@/lib/i18n";
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
  const effectiveLocale = locale === "zh" ? "zh" : localeFromCookie(String(locale));

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
    <main style={{ maxWidth: 900, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>{t("tasks.title")}</h1>
      {loading ? (
        <p>{t("common.loading")}</p>
      ) : tasks.length === 0 ? (
        <p style={{ color: "#888" }}>{t("tasks.empty")}</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id}>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                  <Link href={`/tasks/${task.id}`}>
                    {(task.inputSummary ?? "").split("\n")[0]?.slice(0, 60) || task.id}
                  </Link>
                </td>
                <td
                  style={{
                    padding: 8,
                    borderBottom: "1px solid #eee",
                    color: task.state === "completed" ? "#15803d" : "#666",
                  }}
                >
                  {TASK_STATE_LABELS[effectiveLocale][task.state] ?? task.state}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
