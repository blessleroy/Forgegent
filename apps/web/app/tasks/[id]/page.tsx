"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
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
  sessionId: string | null;
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
    // SSE stream: page close does NOT affect execution (AT-12) — this is a
    // read-only progress subscription with event-id resume.
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

  const isTerminal = task && ["completed", "failed", "cancelled", "interrupted"].includes(task.state);
  const canInteract =
    task && (task.state === "waiting_input" || isTerminal) && task.state !== "cancelled";

  return (
    <main style={{ maxWidth: 760, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>
        {t("task.title")}{" "}
        {task ? (
          <small style={{ color: "#666" }}>
            {t("task.state")}: {TASK_STATE_LABELS[locale][task.state] ?? task.state}
          </small>
        ) : null}
      </h1>
      {task?.inputSummary ? (
        <pre style={{ background: "#f6f6f6", padding: 12, borderRadius: 8, whiteSpace: "pre-wrap" }}>
          {task.inputSummary}
        </pre>
      ) : null}

      <h2>{t("task.messages")}</h2>
      <div style={{ border: "1px solid #eee", borderRadius: 8, maxHeight: 300, overflowY: "auto" }}>
        {events.length === 0 ? (
          <p style={{ color: "#888", padding: 12 }}>…</p>
        ) : (
          events.map((event) => (
            <div key={event.seq} style={{ padding: "6px 12px", borderBottom: "1px solid #f4f4f4", fontSize: 14 }}>
              <code style={{ color: "#0369a1" }}>{event.eventType}</code>{" "}
              {String(event.safePayload?.message ?? event.safePayload?.note ?? "")}
            </div>
          ))
        )}
      </div>

      {canInteract ? (
        <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
          <input
            style={{ flex: 1, padding: 8 }}
            placeholder={t("task.continuePlaceholder")}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <button disabled={busy} onClick={() => sendAction("continue")}>
            {t("task.continue")}
          </button>
        </div>
      ) : null}
      {task && !isTerminal && task.state !== "cancelled" ? (
        <button style={{ marginTop: 12 }} disabled={busy} onClick={() => sendAction("cancel")}>
          {t("task.cancel")}
        </button>
      ) : null}
    </main>
  );
}
