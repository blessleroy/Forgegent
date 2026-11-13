import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { agentReleases } from "@forgegent/db";
import { exportReleaseBundle } from "@forgegent/registry";
import { getReleaseStore } from "@/lib/server";
import { guardRequest } from "@/lib/guard";
import { ensureBootstrap, getAuth, getDb } from "@/lib/server";

/** GET /api/admin/releases/[id]/export — sanitized bundle download (N7). */
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
    "agent.release.export",
  );
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: guard.status });
  }
  const release = await getDb()
    .select()
    .from(agentReleases)
    .where(eq(agentReleases.id, id))
    .get();
  if (!release) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  const snapshot = getReleaseStore().loadSnapshot(release.id, release.checksum);
  const bundle = exportReleaseBundle(snapshot);
  return new NextResponse(bundle, {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="${snapshot.version}-bundle.json"`,
    },
  });
}
