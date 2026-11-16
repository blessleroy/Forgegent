/**
 * CSRF hardening (FR-10): same-origin enforcement for all state-changing
 * business APIs. The session cookie is SameSite=Lax which already blocks
 * cross-site POSTs from forms; this adds an explicit Origin check.
 */
import { NextResponse } from "next/server";

const ALLOWED_ORIGINS = (process.env.FORGEGENT_TRUSTED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export function checkSameOrigin(request: Request): NextResponse | null {
  const origin = request.headers.get("origin");
  if (!origin) return null; // same-origin GETs / curl without Origin
  const host = request.headers.get("host");
  if (host && new URL(origin).host === host) return null;
  if (ALLOWED_ORIGINS.includes(origin)) return null;
  return NextResponse.json(
    { error: "cross-origin request rejected" },
    { status: 403 },
  );
}
