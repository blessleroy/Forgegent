import { NextResponse } from "next/server";
import { rawQuery } from "@forgegent/db";
import { FileStore } from "@forgegent/storage";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { dataDir, ensureBootstrap, getAuth, getDb } from "@/lib/server";
import { guardRequest } from "@/lib/guard";

/** GET /api/files/[id]/download — protected server-side download (FR-07.5). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await ensureBootstrap();
  const { id } = await params;
  const guard = await guardRequest(
    getAuth(),
    getDb(),
    request.headers.get("cookie"),
    "agent.use",
  );
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: guard.status });
  }
  // Ownership check via metadata, then stream from the store root.
  const row = rawQuery<{ storage_key: string; filename: string; mime: string }>(
    getDb(),
    "SELECT storage_key, filename, mime FROM files WHERE id = ? AND owner_id = ? AND deleted_at IS NULL",
    id,
    guard.context.userId,
  )[0];
  if (!row) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  void FileStore;
  try {
    const path = join(dataDir(), "files", row.storage_key);
    const bytes = readFileSync(path);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": row.mime,
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      },
    });
  } catch {
    return NextResponse.json({ error: "storage error" }, { status: 500 });
  }
}
