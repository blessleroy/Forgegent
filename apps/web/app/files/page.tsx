"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AppShell from "@/components/app-shell";
import { useLocale } from "@/lib/use-locale";

interface FileRow {
  id: string;
  filename: string;
  mime: string;
  size: number;
  createdAt: number;
  taskId: string | null;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function FilesPage() {
  const { t, locale } = useLocale();
  const [files, setFiles] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/files");
    if (res.ok) {
      const data = await res.json();
      setFiles(data.files ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload(file: File) {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/files", { method: "POST", body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setNotice(body.error ?? "上传失败");
      return;
    }
    setNotice(locale === "zh" ? "已上传" : "Uploaded");
    await load();
  }

  async function remove(id: string) {
    const res = await fetch(`/api/files?id=${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setNotice(
        body.error === "REFERENCED_BY_LIVE_TASK"
          ? locale === "zh"
            ? "该文件正被执行中的任务使用，暂不能删除。"
            : "File is in use by a running task."
          : body.error ?? "删除失败",
      );
      return;
    }
    setNotice(locale === "zh" ? "已删除" : "Deleted");
    await load();
  }

  const zh = locale === "zh";

  return (
    <AppShell>
      <h1 className="page-title">{t("files.title")}</h1>
      <p className="page-sub">
        {zh
          ? "个人上传与任务成果都在这里；配额默认单文件 50MB、总量 2GB。"
          : "Your uploads and task artifacts; quota 50MB/file, 2GB total."}
      </p>
      <div style={{ marginBottom: 14 }}>
        <input
          ref={inputRef}
          type="file"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = "";
          }}
        />
        <button className="btn btn-primary" onClick={() => inputRef.current?.click()}>
          {zh ? "上传文件" : "Upload"}
        </button>
        {notice ? (
          <span style={{ marginLeft: 12, fontSize: 13, color: "var(--steel)" }}>{notice}</span>
        ) : null}
      </div>
      {loading ? (
        <p style={{ color: "var(--ink-faint)" }}>{t("common.loading")}</p>
      ) : files.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "48px 24px" }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{t("files.empty")}</div>
          <p style={{ color: "var(--ink-soft)", fontSize: 13, margin: 0 }}>
            {zh ? "上传资料，或在应用任务中生成成果。" : "Upload files, or generate artifacts in app tasks."}
          </p>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{zh ? "文件名" : "Filename"}</th>
              <th>{zh ? "类型" : "Type"}</th>
              <th>{zh ? "大小" : "Size"}</th>
              <th>{zh ? "来源任务" : "From task"}</th>
              <th style={{ width: 150 }} />
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.id}>
                <td style={{ fontWeight: 500 }}>{f.filename}</td>
                <td style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-soft)" }}>
                  {f.mime}
                </td>
                <td style={{ fontFamily: "var(--mono)", fontSize: 13 }}>{humanSize(f.size)}</td>
                <td style={{ fontSize: 13 }}>
                  {f.taskId ? (
                    <a href={`/tasks/${f.taskId}`} style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
                      {f.taskId.slice(0, 8)}…
                    </a>
                  ) : (
                    <span style={{ color: "var(--ink-faint)" }}>{zh ? "手动上传" : "manual"}</span>
                  )}
                </td>
                <td>
                  <a className="btn btn-sm" href={`/api/files/${f.id}/download`}>
                    {t("files.download")}
                  </a>{" "}
                  <button className="btn btn-sm btn-danger" onClick={() => remove(f.id)}>
                    {zh ? "删除" : "Delete"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </AppShell>
  );
}
