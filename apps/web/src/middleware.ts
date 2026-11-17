import { NextResponse, type NextRequest } from "next/server";
import { checkSameOrigin } from "@/lib/csrf";

/**
 * Task 1.6 (FR-10, remediation #11): explicit Origin enforcement for EVERY
 * state-changing API call, applied centrally here instead of one route at a
 * time. Same-origin requests and Origin-less clients (curl, same-origin
 * GETs) pass; everything else must be listed in FORGEGENT_TRUSTED_ORIGINS.
 *
 * Read-only methods are out of scope; better-auth's own endpoints keep their
 * trustedOrigins handling on top of this check.
 */
export function middleware(request: NextRequest) {
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  if (mutating) {
    const rejected = checkSameOrigin(request);
    if (rejected) return rejected;
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
