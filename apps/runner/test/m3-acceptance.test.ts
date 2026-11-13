/**
 * M3 acceptance E2E (task 8.6): proposal agent with authorized shared-doc
 * retrieval → outline confirmation (waiting_input) → DOCX artifact in the
 * employee's personal space. Access control verified end-to-end (AT-10).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, rawExec, readTaskEvents, users } from "@forgegent/db";
import type { ForgegentDb } from "@forgegent/db";
import {
  addSharedDocResource,
  createDraft,
  listAgentsForUser,
  reviewDraft,
  setAgentGrants,
  searchSharedDocs,
  ReleaseStore,
} from "@forgegent/registry";
import { continueTask, createTask, getTaskForUser, transitionTask } from "@forgegent/tasks";
import { FileStore } from "@forgegent/storage/src/index.js";

const db: ForgegentDb = createTestDb();
const releasesDir = mkdtempSync(join(tmpdir(), "m3-rel-"));
const filesDir = mkdtempSync(join(tmpdir(), "m3-files-"));
const store = new ReleaseStore(releasesDir);
store.init();

const builder = "m3-builder";
const admin = "m3-admin";
const insider = "m3-insider"; // 财务部门成员 — 有权检索财务方案
const outsider = "m3-outsider"; // 普通员工 — 无权

beforeAll(async () => {
  for (const [id, email] of [
    [builder, "builder@m3.local"],
    [admin, "admin@m3.local"],
    [insider, "in@m3.local"],
    [outsider, "out@m3.local"],
  ] as const) {
    await db.insert(users).values({ id, email }).onConflictDoNothing();
  }
  rawExec(db, "INSERT OR IGNORE INTO departments (id, name) VALUES ('dept-fin3', 'finance-3')");
  rawExec(db, "INSERT OR IGNORE INTO user_departments (user_id, department_id) VALUES (?, 'dept-fin3')", insider);

  // 企业历史方案库（财务方案：仅财务部门可读）
  addSharedDocResource(db, {
    name: "历史方案库",
    entries: [
      { id: "p1", title: "Q3 财务方案", content: "历史财务方案：预算与回报分析" },
      { id: "p2", title: "审计整改方案", content: "历史审计整改要点" },
    ],
    grants: [{ subjectType: "department", subjectId: "dept-fin3" }],
  });

  // 发布方案生成专家（document-flow）
  const draft = await createDraft(db, {
    builderId: builder,
    slug: "proposal-expert",
    payload: {
      schemaVersion: "1.0",
      name: "方案生成专家",
      description: "检索授权历史方案，分阶段生成 DOCX 方案",
      version: "1.0.0",
      ui: {
        type: "document-flow",
        schema: {
          uploadField: { name: "requirements", label: "客户需求", type: "textarea", required: true },
          outlineStage: { label: "大纲确认" },
          progressStage: { label: "生成进度" },
          downloadStage: { label: "下载文档" },
        },
      },
      runtime: { engine: "pi-coding-agent", mode: "restricted" },
      modelRef: "default",
      toolRefs: ["resources.search", "document.export"],
      resourceRefs: ["历史方案库"],
      prompts: { system: "你是方案生成专家。仅检索授权资料，先产出大纲供确认。" },
      tests: { cases: ["检索授权资料", "确认大纲后输出 DOCX"] },
    },
  });
  rawExec(db, "INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'role-builder')", builder);
  rawExec(db, "UPDATE agent_drafts SET state = 'in_review' WHERE id = ?", draft.draftId);
  await reviewDraft(db, store, {
    draftId: draft.draftId,
    adminId: admin,
    decision: "approve",
  });
  await setAgentGrants(db, {
    agentId: draft.agentId,
    grants: [{ subjectType: "all_users" }],
  });
});

afterAll(() => {
  for (const dir of [releasesDir, filesDir]) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

describe("M3 acceptance (task 8.6 — proposal agent loop)", () => {
  it("insider runs the full loop; outsider never sees restricted docs (AT-10)", async () => {
    // Both users can see the app (all_users grant)...
    for (const userId of [insider, outsider]) {
      const visible = await listAgentsForUser(db, { userId, roles: ["employee"] });
      expect(visible.some((a) => a.slug === "proposal-expert")).toBe(true);
    }
    // ...but retrieval is ACL-filtered per user (AT-10 core).
    const insiderHits = await searchSharedDocs(db, { userId: insider, query: "方案" });
    expect(insiderHits.length).toBe(2);
    const outsiderHits = await searchSharedDocs(db, { userId: outsider, query: "方案" });
    expect(outsiderHits).toEqual([]);

    // Insider task: 需求 → 检索 → 大纲确认（waiting_input）→ DOCX 交付。
    const task = await createTask(db, {
      ownerId: insider,
      roles: ["employee"],
      agentId: (await listAgentsForUser(db, { userId: insider, roles: ["employee"] })).find(
        (a) => a.slug === "proposal-expert",
      )!.id,
      inputSummary: "客户需求：年度财务回顾方案，参考历史方案库",
    });
    await transitionTask(db, task.id, "pending", "starting");
    await transitionTask(db, task.id, "starting", "running");

    // Agent loop (mocked): authorized retrieval → outline → waiting_input.
    const fileStore = new FileStore(filesDir, db);
    const hits = await searchSharedDocs(db, { userId: insider, query: "方案" });
    expect(hits.length).toBeGreaterThan(0);
    const outline = `大纲\n1. 背景（引用 ${hits.length} 份授权方案）\n2. 预算回顾\n3. 建议`;
    const { appendTaskEvent } = await import("@forgegent/db");
    appendTaskEvent(db, task.id, "outline.proposed", { outline });
    await transitionTask(db, task.id, "running", "waiting_input");

    // Employee confirms the outline via the message flow (D27).
    const resumed = await continueTask(db, {
      taskId: task.id,
      userId: insider,
      roles: ["employee"],
      message: "大纲确认，请输出完整方案",
    });
    expect(resumed.state).toBe("running");

    // Final DOCX artifact lands in the insider's personal space.
    const artifact = await fileStore.put({
      ownerId: insider,
      filename: "proposal-2026.docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: Buffer.from("PK\x03\x04mock-docx"),
      taskId: task.id,
    });
    rawExec(
      db,
      "INSERT OR REPLACE INTO task_file_refs (task_id, file_id, direction) VALUES (?, ?, 'output')",
      task.id,
      artifact.id,
    );
    await transitionTask(db, task.id, "running", "completed");

    const done = await getTaskForUser(db, {
      taskId: task.id,
      userId: insider,
      roles: ["employee"],
    });
    expect(done.state).toBe("completed");
    const events = readTaskEvents(db, task.id).map((e) => e.eventType);
    expect(events).toContain("outline.proposed");
    expect(events).toContain("task.continued");
    const files = await fileStore.list(insider);
    expect(files.some((f) => f.filename === "proposal-2026.docx")).toBe(true);
    // Outsider's space stays empty — strict per-user isolation.
    expect(await fileStore.list(outsider)).toHaveLength(0);
  });
});
