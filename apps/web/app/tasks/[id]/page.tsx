"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import AppShell from "@/components/app-shell";
import { TASK_STATE_LABELS } from "@/lib/i18n";
import { useLocale } from "@/lib/use-locale";

interface TaskEvent {
  seq: number;
  eventType: string;
  safePayload: Record<string, unknown> | null;
}

interface TaskDetail {
  id: string;
  state: string;
  inputSummary: string | null;
}

function payloadText(payload: Record<string, unknown> | null): string {
  if (!payload) return "";
  return String(payload.message ?? payload.reason ?? payload.text ?? payload.note ?? "");
}

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const { t, locale } = useLocale();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const lastSeqRef = useRef(0);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/tasks/${params.id}`);
    if (res.ok) {
      const data = await res.json();
      setTask(data.task);
    }
    const evRes = await fetch(`/api/tasks/${params.id}/events?after=${lastSeqRef.current}`);
    if (evRes.ok) {
      const data = await evRes.json();
      const incoming = (data.events ?? []) as TaskEvent[];
      if (incoming.length > 0) {
        lastSeqRef.current = incoming[incoming.length - 1]!.seq;
        setEvents((prev) => [...prev, ...incoming]);
      }
    }
  }, [params.id]);

  useEffect(() => {
    void refresh();
    const es = new EventSource(`/api/tasks/${params.id}/stream?after=${lastSeqRef.current}`);
    es.addEventListener("task-event", (e) => {
      const event = JSON.parse((e as MessageEvent).data) as TaskEvent;
      if (event.seq > lastSeqRef.current) {
        lastSeqRef.current = event.seq;
        setEvents((prev) => [...prev, event]);
      }
      void refresh();
    });
    es.addEventListener("done", () => {
      es.close();
      void refresh();
    });
    es.onerror = () => es.close();
    return () => es.close();
  }, [params.id, refresh]);

  async function sendAction(action: "continue" | "cancel") {
    if (action === "continue" && !message.trim()) return;
    setBusy(true);
    await fetch(`/api/tasks/${params.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, message }),
    });
    setMessage("");
    setBusy(false);
    await refresh();
  }

  const isTerminal =
    task && ["completed", "failed", "cancelled", "interrupted"].includes(task.state);
  const canInteract =
    task && (task.state === "waiting_input" || isTerminal) && task.state !== "cancelled";

  return (
    <AppShell>
      <h1 className="page-title">
        {t("task.title")}
        {task ? (
          <span className={`badge s-${task.state}`} style={{ marginLeft: 12, verticalAlign: "middle" }}>
            {TASK_STATE_LABELS[locale][task.state] ?? task.state}
          </span>
        ) : null}
      </h1>
      <p className="page-sub">
        <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{params.id}</span>
      </p>

      {task?.inputSummary ? (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, color: "var(--ink-faint)", marginBottom: 6 }}>
            {t("app.input")}
          </div>
          <div style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{task.inputSummary}</div>
        </div>
      ) : null}

      <div className="h2">{t("task.messages")}</div>
      <div className="timeline">
        {events.length === 0 ? (
          <div className="tl-item" style={{ color: "var(--ink-faint)" }}>…</div>
        ) : (
          events.map((event) => {
            const hot = event.eventType === "task.continued" || event.eventType === "run.failed";
            return (
              <div key={event.seq} className={`tl-item${hot ? " hot" : ""}`}>
                <span className="tl-type">{event.eventType}</span>{" "}
                <span className="tl-text">{payloadText(event.safePayload).slice(0, 160)}</span>
              </div>
            );
          })
        )}
      </div>

      {canInteract ? (
        <div style={{ marginTop: 20, display: "flex", gap: 8, maxWidth: 640 }}>
          <input
            className="input"
            placeholder={t("task.continuePlaceholder")}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendAction("continue")}
          />
          <button className="btn btn-primary" disabled={busy} onClick={() => sendAction("continue")}>
            {t("task.continue")}
          </button>
        </div>
      ) : null}
      {task && !isTerminal && task.state !== "cancelled" ? (
        <div style={{ marginTop: 14 }}>
          <button className="btn btn-danger" disabled={busy} onClick={() => sendAction("cancel")}>
            {t("task.cancel")}
          </button>
        </div>
      ) : null}
    </AppShell>
  );
}
