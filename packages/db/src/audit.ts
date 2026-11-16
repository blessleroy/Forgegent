/**
 * Audit logging (audit-observability spec, task 1.8).
 *
 * Hard rule: audit rows and redacted logs must never contain secret values
 * (FR-09.7). The redactor strips credential-shaped content from any payload
 * before persistence.
 */
import { randomUUID } from "node:crypto";
import { auditLogs } from "./schema.js";
import type { ForgegentDb } from "./index.js";

export interface AuditEvent {
  actorId?: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  /** allow | deny */
  decision: "allow" | "deny";
  reason?: string;
  payload?: Record<string, unknown>;
}

const SECRET_KEY_PATTERN =
  /(api[_-]?key|secret|password|token|authorization|credential|bearer)/i;

/** Recursively redact secret-shaped keys and credential-like string values. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[depth-limit]";
  if (typeof value === "string") {
    // Sk-... style keys, bearer tokens, long hex/base64 secrets.
    if (
      /^(sk-|pk-|Bearer\s|Basic\s)/i.test(value) ||
      /^[a-f0-9]{32,}$/i.test(value)
    ) {
      return "[redacted]";
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SECRET_KEY_PATTERN.test(key)
        ? "[redacted]"
        : redact(item, depth + 1);
    }
    return out;
  }
  return value;
}

/** Persist an audit event with sanitized payload folded into reason. */
export async function audit(
  forgegentDb: ForgegentDb,
  event: AuditEvent,
): Promise<string> {
  const id = randomUUID();
  const safeReason = event.reason
    ? String(redact(event.reason))
    : undefined;
  const payloadNote = event.payload
    ? JSON.stringify(redact(event.payload))
    : undefined;
  await forgegentDb.insert(auditLogs).values({
    id,
    actorId: event.actorId ?? null,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    decision: event.decision,
    reason: [safeReason, payloadNote].filter(Boolean).join(" | ") || null,
  });
  return id;
}

/** Structured JSON log line with mandatory redaction. */
export function logJson(
  component: string,
  level: "info" | "warn" | "error",
  message: string,
  fields?: Record<string, unknown>,
): string {
  return JSON.stringify({
    ts: new Date().toISOString(),
    component,
    level,
    message: String(redact(message)),
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  });
}
