import { NextResponse } from "next/server";
import { rawExec, rawQuery } from "@forgegent/db";
import { addSharedDocResource, declareHttpTool } from "@forgegent/registry";
import { probeOpenAiCompatibleEndpoint } from "@forgegent/pi-adapter";
import { guardRequest } from "@/lib/guard";
import { ensureBootstrap, getAuth, getDb } from "@/lib/server";

/** GET /api/admin/resources — all resources + grants. */
export async function GET(request: Request) {
  await ensureBootstrap();
  const guard = await guardRequest(
    getAuth(),
    getDb(),
    request.headers.get("cookie"),
    "resource.manage",
  );
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: guard.status });
  }
  const resources = rawQuery(
    getDb(),
    "SELECT id, kind, name, config, created_at AS createdAt FROM resources ORDER BY created_at DESC",
  );
  return NextResponse.json({ resources });
}

/** POST /api/admin/resources — create/update a resource (admin action). */
export async function POST(request: Request) {
  await ensureBootstrap();
  const guard = await guardRequest(
    getAuth(),
    getDb(),
    request.headers.get("cookie"),
    "resource.manage",
  );
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: guard.status });
  }
  const body = (await request.json().catch(() => null)) as {
    action?: "add-model-endpoint" | "add-http-tool" | "add-shared-doc" | "delete";
    baseUrl?: string;
    model?: string;
    apiKey?: string;
    /** D44: optional per-M-token pricing in cents (estimated_cost/budget). */
    priceInputCentsPerM?: number;
    priceOutputCentsPerM?: number;
    name?: string;
    endpoint?: string;
    method?: "GET" | "POST";
    paramSchema?: Record<string, unknown>;
    authType?: "bearer-env" | "none";
    credentialEnv?: string;
    entries?: { id: string; title: string; content: string }[];
    grants?: { subjectType: string; subjectId?: string }[];
    resourceId?: string;
  } | null;
  if (!body?.action) {
    return NextResponse.json({ error: "action required" }, { status: 400 });
  }
  const db = getDb();
  try {
    if (body.action === "add-model-endpoint") {
      if (!body.baseUrl || !body.model || !body.apiKey) {
        return NextResponse.json(
          { error: "baseUrl, model, apiKey required" },
          { status: 400 },
        );
      }
      // Save-time probe (resource-governance spec: validate before persist).
      const probe = await probeOpenAiCompatibleEndpoint(body.baseUrl, body.apiKey);
      if (!probe.ok) {
        return NextResponse.json(
          { error: `端点探活失败: ${probe.error}` },
          { status: 400 },
        );
      }
      rawExec(
        db,
        "DELETE FROM resources WHERE kind = 'model_endpoint'",
      );
      // D44: optional per-M-token pricing (cents) drives estimated_cost and
      // the maxCostCents budget; unset → cost 0 and the fee budget no-ops
      // (explicitly noted in run events).
      const config: Record<string, unknown> = {
        baseUrl: body.baseUrl,
        model: body.model,
        apiKeyEnv: "FORGEGENT_MODEL_API_KEY",
      };
      if (body.priceInputCentsPerM !== undefined && body.priceInputCentsPerM !== null) {
        config.priceInputCentsPerM = Number(body.priceInputCentsPerM);
      }
      if (body.priceOutputCentsPerM !== undefined && body.priceOutputCentsPerM !== null) {
        config.priceOutputCentsPerM = Number(body.priceOutputCentsPerM);
      }
      rawExec(
        db,
        "INSERT INTO resources (id, kind, name, config) VALUES (?, 'model_endpoint', 'default', ?)",
        crypto.randomUUID(),
        JSON.stringify(config),
      );
      return NextResponse.json({ ok: true, modelCount: probe.modelCount });
    }
    if (body.action === "add-http-tool") {
      const config = declareHttpTool(db, {
        name: body.name ?? "unnamed-tool",
        endpoint: body.endpoint ?? "",
        method: body.method ?? "GET",
        paramSchema: body.paramSchema ?? { type: "object", properties: {} },
        authType: body.authType ?? "none",
        credentialEnv: body.credentialEnv,
      });
      return NextResponse.json(config, { status: 201 });
    }
    if (body.action === "add-shared-doc") {
      if (!body.name || !body.entries) {
        return NextResponse.json(
          { error: "name and entries required" },
          { status: 400 },
        );
      }
      const result = addSharedDocResource(db, {
        name: body.name,
        entries: body.entries,
        grants: body.grants ?? [{ subjectType: "all_users" }],
      });
      return NextResponse.json(result, { status: 201 });
    }
    if (body.action === "delete") {
      if (!body.resourceId) {
        return NextResponse.json({ error: "resourceId required" }, { status: 400 });
      }
      rawExec(db, "DELETE FROM resource_grants WHERE resource_id = ?", body.resourceId);
      rawExec(db, "DELETE FROM resources WHERE id = ?", body.resourceId);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: String((error as Error).message).slice(0, 200) },
      { status: 400 },
    );
  }
}
