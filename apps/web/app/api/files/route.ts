import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { audit, files, rawQuery } from "@forgegent/db";
import { FileStore } from "@forgegent/storage";
import { join } from "node:path";
import { guardRequest } from "@/lib/guard";
import { dataDir, ensureBootstrap, getAuth, getDb, uploadPolicy } from "@/lib/server";

/** GET /api/files — the caller's personal file list. */
export async function GET(request: Request) {
  await ensureBootstrap();
  const guard = await guardRequest(
    getAuth(),
    getDb(),
    request.headers.get("cookie"),
    "agent.use",
  );
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: guard.status });
  }
  const rows = rawQuery(
    getDb(),
    `SELECT id, filename, mime, size, created_at AS createdAt,
            (SELECT t.id FROM task_file_refs r JOIN tasks t ON t.id = r.task_id WHERE r.file_id = files.id AND r.direction = 'output' LIMIT 1) AS taskId
     FROM files WHERE owner_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
    guard.context.userId,
  );
  return NextResponse.json({ files: rows });
}

/** POST /api/files — upload into the caller's personal space. */
export async function POST(request: Request) {
  await ensureBootstrap();
  const guard = await guardRequest(
    getAuth(),
    getDb(),
    request.headers.get("cookie"),
    "agent.use",
  );
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: guard.status });
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  const policy = uploadPolicy();
  if (file.size > policy.maxFileBytes) {
    return NextResponse.json(
      { error: `文件超过 ${Math.round(policy.maxFileBytes / 1024 / 1024)}MB 上限` },
      { status: 400 },
    );
  }
  const store = new FileStore(join(dataDir(), "files"), getDb(), uploadPolicy());
  try {
    const saved = await store.put({
      ownerId: guard.context.userId,
      filename: file.name,
      mime: file.type || "application/octet-stream",
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    await audit(getDb(), {
      actorId: guard.context.userId,
      action: "file.upload",
      resourceType: "file",
      resourceId: saved.id,
      decision: "allow",
    });
    return NextResponse.json(saved, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: String((error as Error).message).slice(0, 200) },
      { status: 400 },
    );
  }
}

/** DELETE /api/files?id=... — soft delete (blocked while referenced). */
export async function DELETE(request: Request) {
  await ensureBootstrap();
  const guard = await guardRequest(
    getAuth(),
    getDb(),
    request.headers.get("cookie"),
    "agent.use",
  );
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: guard.status });
  }
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const store = new FileStore(join(dataDir(), "files"), getDb(), uploadPolicy());
  try {
    await store.softDelete(guard.context.userId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const detail = (error as { detail?: { code?: string; taskId?: string } }).detail;
    return NextResponse.json(
      { error: detail?.code ?? "delete-failed", taskId: detail?.taskId },
      { status: 400 },
    );
  }
}

/** GET download passthrough is served by /api/files/[id]/download. */
void eq;
void files;
