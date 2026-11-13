import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  createPlatformSession,
  normalizeBaseUrl,
  probeOpenAiCompatibleEndpoint,
} from "../src/index.js";

const tmpDirs: string[] = [];
afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

describe("restricted session factory (task 2.2)", () => {
  it("applies the tool allowlist — no shell by default", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-restricted-"));
    tmpDirs.push(cwd);
    const session = await createPlatformSession({
      cwd,
      mode: "restricted",
      toolAllowlist: ["read"],
    });
    const names = session.getActiveToolNames();
    expect(names).toContain("read");
    expect(names).not.toContain("bash");
    expect(names).not.toContain("write");
    expect(names).not.toContain("edit");
    session.dispose();
  });

  it("runs without any tools when the allowlist is empty", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-notools-"));
    tmpDirs.push(cwd);
    const session = await createPlatformSession({
      cwd,
      mode: "restricted",
      toolAllowlist: [],
    });
    expect(session.getActiveToolNames()).toEqual([]);
    session.dispose();
  });

  it("sandboxed mode is deferred to M3", async () => {
    await expect(
      createPlatformSession({ cwd: "/tmp", mode: "sandboxed" }),
    ).rejects.toThrow(/M3/);
  });
});

describe("endpoint base URL normalization (task 2.3)", () => {
  it("strips trailing slashes and validates scheme", () => {
    expect(normalizeBaseUrl("https://api.example.com/v1/")).toBe(
      "https://api.example.com/v1",
    );
    expect(normalizeBaseUrl("http://localhost:9000/v1///")).toBe(
      "http://localhost:9000/v1",
    );
    expect(() => normalizeBaseUrl("ftp://x")).toThrow(/invalid base URL/);
    expect(() => normalizeBaseUrl("no-scheme")).toThrow(/invalid base URL/);
  });
});

describe("endpoint probe (task 2.3 — resource-governance spec)", () => {
  it("reports unreachable endpoints with a clear error", async () => {
    const result = await probeOpenAiCompatibleEndpoint(
      "https://127.0.0.1:9/v1",
      "sk-test",
      undefined,
      2_000,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unreachable/);
  });

  it("reports auth failures distinctly", async () => {
    const fakeFetch = (async () =>
      new Response("denied", { status: 401 })) as unknown as typeof fetch;
    const result = await probeOpenAiCompatibleEndpoint(
      "https://gw.example.com/v1",
      "sk-bad",
      fakeFetch,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/authentication failed/);
  });

  it("accepts valid OpenAI-style model lists", async () => {
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({ data: [{ id: "gpt-x" }, { id: "gpt-y" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;
    const result = await probeOpenAiCompatibleEndpoint(
      "https://gw.example.com/v1/",
      "sk-good",
      fakeFetch,
    );
    expect(result.ok).toBe(true);
    expect(result.modelCount).toBe(2);
  });
});
