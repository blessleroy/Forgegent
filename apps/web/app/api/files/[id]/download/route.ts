import { NextResponse } from "next/server";
import { FileStore } from "@forgegent/storage";
import { join } from "node:path";
import { dataDir, ensureBootstrap, getAuth, getDb } from "@/lib/server";
import { guardRequest } from "@/lib/guard";

/**
 * GET /api/files/[id]/download — protected server-side download (FR-07.5).
 *
 * Task 1.8 (remediation #13): the route serves through FileStore so the
 * download inherits the SAME defences as every other read — storageKey
 * format validation, realpath/symlink containment, owner ACL and streaming
 * — instead of a bare `join(dataDir(), "files", storage_key)` + readFileSync
 * that bypassed the store's validation layers.
 */
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
  const store = new FileStore(join(dataDir(), "files"), getDb());
  try {
    const dl = await store.openDownload(guard.context.userId, id);
    return new NextResponse(dl.stream as unknown as ReadableStream<Uint8Array>, {
      headers: {
        "content-type": dl.mime,
        "content-length": String(dl.size),
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(dl.filename)}`,
      },
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    // NOT_FOUND and FORBIDDEN both map to 404 (no file-existence leak).
    if (code === "NOT_FOUND" || code === "FORBIDDEN") {
      return NextResponse.json({ error: code }, { status: 404 });
    }
    return NextResponse.json({ error: "storage error" }, { status: 500 });
  }
}
