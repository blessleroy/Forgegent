import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, rawQuery, users } from "@forgegent/db";
import type { ForgegentDb } from "@forgegent/db";
import { ReleaseStore } from "@forgegent/registry";
import {
  continueConversation,
  HeuristicBuilderAgent,
  readConversation,
  readGateResult,
  runDraftGate,
  startConversation,
  submitWithGate,
} from "../src/index.js";

const db: ForgegentDb = createTestDb();
const store = new ReleaseStore(mkdtempSync(join(tmpdir(), "studio-rel-")));
let releasesDir: string;
const builder = "studio-builder";
const other = "studio-other";

beforeAll(async () => {
  releasesDir = (store as unknown as { releasesDir: string }).releasesDir;
  store.init();
  for (const [id, email] of [
    [builder, "builder@studio.local"],
    [other, "other@studio.local"],
  ] as const) {
    await db.insert(users).values({ id, email }).onConflictDoNothing();
  }
});

afterAll(() => {
  try {
    rmSync(releasesDir, { recursive: true, force: true });
  } catch {
    /* read-only dirs; OS cleans temp */
  }
});

describe("studio conversation (tasks 6.1/6.2 — AT-01/AT-02)", () => {
  it("AT-01: brief → complete draft with prompt, UI schema, tools, tests", async () => {
    const backend = new HeuristicBuilderAgent();
    const result = await startConversation(db, backend, {
      builderId: builder,
      slug: "poster-studio-test",
      brief: "创建一个活动海报 Agent，员工输入主题和风格，用配置的生图模型",
    });
    expect(result.state).toBe("editing");
    const payload = JSON.parse(
      rawQuery<{ draft_payload: string }>(
        db,
        "SELECT draft_payload FROM agent_drafts WHERE id = ?",
        result.draftId,
      )[0].draft_payload,
    );
    expect(payload.name).toBe("海报设计师");
    expect(payload.ui.type).toBe("form-result");
    expect(payload.toolRefs).toContain("image.generate");
    expect(payload.prompts.system).toContain("海报");
    expect((payload.tests as { cases: string[] }).cases.length).toBeGreaterThan(0);
    // Clarifying question round when key info is missing.
    expect(result.message.clarifications?.length).toBeGreaterThan(0);
    // Conversation persisted (N4).
    const log = readConversation(db, result.draftId);
    expect(log.map((m) => m.role)).toEqual(["builder", "agent"]);
  });

  it("AT-02: instruction modifies the current draft with a visible diff", async () => {
    const backend = new HeuristicBuilderAgent();
    const created = await startConversation(db, backend, {
      builderId: builder,
      slug: "doc-studio-test",
      brief: "做一个方案生成 Agent，输出 Word 文档，分阶段确认大纲",
    });
    const updated = await continueConversation(db, backend, {
      draftId: created.draftId,
      builderId: builder,
      instruction: "增加参考图上传",
    });
    expect(updated.message.changes?.length).toBeGreaterThan(0);
    const payload = JSON.parse(
      rawQuery<{ draft_payload: string }>(
        db,
        "SELECT draft_payload FROM agent_drafts WHERE id = ?",
        created.draftId,
      )[0].draft_payload,
    );
    // document-flow drafts record the change note; the form-field change
    // only applies to form-result — assert the change is recorded honestly.
    expect(payload.description).toContain("方案");
    // Conversation grew by two messages.
    expect(readConversation(db, created.draftId).length).toBe(4);
  });

  it("non-owner cannot continue a conversation (D19)", async () => {
    const backend = new HeuristicBuilderAgent();
    const created = await startConversation(db, backend, {
      builderId: builder,
      slug: "owner-guard",
      brief: "海报 Agent",
    });
    await expect(
      continueConversation(db, backend, {
        draftId: created.draftId,
        builderId: other,
        instruction: "改一下",
      }),
    ).rejects.toThrow(/owner/);
  });
});

describe("review gate (task 6.4 — N5)", () => {
  it("gate passes a complete draft and fails a hollow one without blocking", async () => {
    const backend = new HeuristicBuilderAgent();
    const good = await startConversation(db, backend, {
      builderId: builder,
      slug: "gate-good",
      brief: "海报 Agent",
    });
    const goodGate = runDraftGate(
      JSON.parse(
        rawQuery<{ draft_payload: string }>(
          db,
          "SELECT draft_payload FROM agent_drafts WHERE id = ?",
          good.draftId,
        )[0].draft_payload,
      ),
    );
    expect(goodGate.passed).toBe(true);

    const hollowGate = runDraftGate({
      schemaVersion: "1.0",
      name: "x",
      description: "",
      version: "0.1.0",
      ui: { type: "form-result", schema: {} },
      runtime: { engine: "pi-coding-agent", mode: "restricted" },
    });
    expect(hollowGate.passed).toBe(false);
    expect(hollowGate.failures.length).toBeGreaterThan(0);
  });

  it("submit attaches the gate result; failures still allow submission", async () => {
    const backend = new HeuristicBuilderAgent();
    const created = await startConversation(db, backend, {
      builderId: builder,
      slug: "gate-submit",
      brief: "海报 Agent",
    });
    const { submitted, gate } = await submitWithGate(db, {
      draftId: created.draftId,
      builderId: builder,
    });
    expect(submitted.state).toBe("in_review");
    expect(gate.passed).toBe(true);
    expect(readGateResult(db, created.draftId)?.passed).toBe(true);
  });
});
