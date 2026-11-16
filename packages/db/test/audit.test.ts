import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { audit, logJson, redact } from "../src/audit.js";
import { auditLogs, users } from "../src/schema.js";
import { createTestDb } from "../src/index.js";

describe("audit redaction (task 1.8)", () => {
  it("redacts secret-shaped keys", () => {
    const out = redact({
      api_key: "sk-abc123",
      nested: { Authorization: "Bearer xyz", ok: 1 },
      keep: "hello",
    }) as Record<string, unknown>;
    expect(out["api_key"]).toBe("[redacted]");
    const nested = out["nested"] as Record<string, unknown>;
    expect(nested["Authorization"]).toBe("[redacted]");
    expect(nested["ok"]).toBe(1);
    expect(out["keep"]).toBe("hello");
  });

  it("redacts credential-like string values", () => {
    expect(redact("sk-live-9f8e7d6c")).toBe("[redacted]");
    expect(redact("a".repeat(40).replace(/a/g, "f"))).toBe("[redacted]");
    expect(redact("plain message")).toBe("plain message");
  });

  it("handles arrays and depth limits", () => {
    const out = redact(["sk-1", "ok"]) as unknown[];
    expect(out[0]).toBe("[redacted]");
    expect(out[1]).toBe("ok");
  });

  it("audit() persists sanitized rows", async () => {
    const db = createTestDb();
    await db
      .insert(users)
      .values({ id: "u1", email: "u1@test.local", passwordHash: "x" });
    await audit(db, {
      actorId: "u1",
      action: "tool.invoke",
      resourceId: "res-1",
      decision: "deny",
      reason: "blocked",
      payload: { token: "sk-secret", model: "gpt-x" },
    });
    const row = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "tool.invoke"))
      .get();
    expect(row?.decision).toBe("deny");
    expect(row?.reason).toContain("[redacted]");
    expect(row?.reason).toContain("gpt-x");
    expect(row?.reason).not.toContain("sk-secret");
  });

  it("logJson emits redacted structured lines", () => {
    const line = logJson("runner", "info", "calling model", {
      apiKey: "sk-abc",
      taskId: "t1",
    });
    const parsed = JSON.parse(line);
    expect(parsed.apiKey).toBe("[redacted]");
    expect(parsed.taskId).toBe("t1");
  });
});
