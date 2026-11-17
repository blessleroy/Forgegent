import { describe, expect, it } from "vitest";
import {
  createPosterTool,
  validateImagePayload,
} from "../src/tools/poster.js";

/** Minimal 1x1 PNG base64 (valid header, small but over the size floor
 *  is enforced via a padded payload in the happy-path fixture). */
const PNG_HEAD = "iVBORw0KGgo=";

describe("poster tool (task 4.5 — task-execution idempotency + validation)", () => {
  it("validates image payload formats", () => {
    expect(validateImagePayload("/9j/4AAQ" + "x".repeat(2000))).toMatchObject({ ok: true, mime: "image/jpeg" });
    expect(validateImagePayload("iVBORw0KGgo" + "x".repeat(2000))).toMatchObject({ ok: true, mime: "image/png" });
    expect(validateImagePayload("tiny")).toMatchObject({ ok: false });
    expect(validateImagePayload("XXXX" + "x".repeat(2000))).toMatchObject({ ok: false });
  });

  it("generates via the OpenAI-compatible images endpoint", async () => {
    const fake = (async (url: string | URL | Request) => {
      expect(String(url)).toContain("/images/generations");
      return new Response(
        JSON.stringify({ data: [{ b64_json: PNG_HEAD + "x".repeat(2048) }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const tool = createPosterTool(
      { baseUrl: "https://gw.local/v1", apiKey: "sk-test", model: "img-x" },
      fake,
    );
    const out = await tool.execute({ prompt: "秋日促销海报", key: "task-1:1" });
    expect(out).toMatch(/^generated:task-1:1:image\/png:/);
  });

  it("same key returns cached result — no duplicate billing (FR-06.8)", async () => {
    let calls = 0;
    const fake = (async () => {
      calls += 1;
      return new Response(
        JSON.stringify({ data: [{ b64_json: PNG_HEAD + "x".repeat(2048) }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const tool = createPosterTool(
      { baseUrl: "https://gw.local/v1", apiKey: "k", model: "m" },
      fake,
    );
    await tool.execute({ prompt: "a", key: "k1" });
    await tool.execute({ prompt: "a", key: "k1" });
    expect(calls).toBe(1);
  });

  it("surfaces endpoint errors clearly", async () => {
    const fake = (async () =>
      new Response(JSON.stringify({ error: { message: "quota exceeded" } }), {
        status: 429,
      })) as unknown as typeof fetch;
    const tool = createPosterTool(
      { baseUrl: "https://gw.local/v1", apiKey: "k", model: "m" },
      fake,
    );
    const out = await tool.execute({ prompt: "a", key: "k2" });
    expect(out).toMatch(/error:.*429.*quota exceeded/);
  });
});

describe("R4 task 4.5 — poster idempotency persists across instances (restarts)", () => {
  const b64 = "iVBOR" + "A".repeat(2000);
  function fetchStub() {
    return async () =>
      new Response(JSON.stringify({ data: [{ b64_json: b64 }] }), { status: 200 });
  }
  it("a fresh tool with the persisted record returns cached without calling the API", async () => {
    const records = new Map<string, unknown>();
    const persistence = {
      get: (k: string) => records.get(k) as never,
      set: (k: string, v: unknown) => void records.set(k, v),
    };
    const first = createPosterTool(
      { baseUrl: "http://img.local/v1", apiKey: "k", model: "m" },
      fetchStub() as typeof fetch,
      persistence,
    );
    const out1 = await first.execute({ prompt: "poster", key: "task-1:gen" });
    expect(out1).toContain("generated:");
    expect(records.size).toBe(1);

    // "Restart": a brand-new tool instance sharing the persistence layer.
    let called = 0;
    const second = createPosterTool(
      { baseUrl: "http://img.local/v1", apiKey: "k", model: "m" },
      (async (...a: unknown[]) => {
        called += 1;
        return (fetchStub() as (...b: unknown[]) => Promise<Response>)(...a);
      }) as typeof fetch,
      persistence,
    );
    const out2 = await second.execute({ prompt: "poster again", key: "task-1:gen" });
    expect(out2).toContain("cached:");
    expect(called).toBe(0);
  });
});
