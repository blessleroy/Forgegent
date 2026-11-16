/**
 * Tool Gateway (permission-enforcement spec, tasks 5.1/5.2).
 *
 * Every tool call is checked against the three-way intersection
 * (user ∩ agent release ∩ task) with deny-by-default:
 *
 *   1. task belongs to the calling user (or admin) and is in an active state;
 *   2. the tool is declared by the task's immutable release (tool_policies
 *      whitelist / payload.toolRefs) — never by the prompt;
 *   3. resource-shaped parameters (fileId) satisfy the user's own ACL;
 *   4. HTTP tool targets stay inside the release's egress allowlist.
 *
 * Denials are audited with actor/action/resource/reason — never secrets.
 */
import { audit, rawQuery } from "@forgegent/db";
import type { ForgegentDb } from "@forgegent/db";

export interface ToolCallContext {
  userId: string;
  roles: string[];
  taskId: string;
  /** Tool identifier, e.g. "image.generate", "http.fetch", "bash". */
  toolId: string;
  /** Untrusted parameters straight from the model. */
  params: Record<string, unknown>;
}

export interface GatewayDecision {
  allowed: boolean;
  reason?: string;
}

interface TaskRow {
  id: string;
  owner_id: string;
  agent_release_id: string;
  state: string;
}

interface PolicyRow {
  tool_id: string;
  resource_scope: string | null;
  allowed_actions: string;
}

export interface GatewayOptions {
  /** Allowed hosts for http.* tools (release egress allowlist). */
  egressAllowlist?: string[];
}

async function check(
  db: ForgegentDb,
  ctx: ToolCallContext,
  options?: GatewayOptions,
): Promise<GatewayDecision> {
  // 1. Task ownership + active state.
  const task = rawQuery<TaskRow>(
    db,
    "SELECT id, owner_id, agent_release_id, state FROM tasks WHERE id = ?",
    ctx.taskId,
  )[0];
  if (!task) return { allowed: false, reason: "task not found" };
  if (task.owner_id !== ctx.userId && !ctx.roles.includes("admin")) {
    return { allowed: false, reason: "task does not belong to caller" };
  }
  if (!["running", "waiting_input", "starting"].includes(task.state)) {
    return { allowed: false, reason: `task state ${task.state} cannot invoke tools` };
  }

  // 2. Release tool whitelist: tool_policies is the authoritative runtime
  //    source (written at publish time from the immutable payload).
  const policies = rawQuery<PolicyRow>(
    db,
    "SELECT tool_id, resource_scope, allowed_actions FROM tool_policies WHERE release_id = ?",
    task.agent_release_id,
  );
  const declared = policies.some((p) => p.tool_id === ctx.toolId);
  if (!declared) {
    return {
      allowed: false,
      reason: `tool "${ctx.toolId}" is not declared by the agent release`,
    };
  }

  // 3. Resource ACL: file parameters must belong to the calling user.
  for (const key of ["fileId", "inputFileId", "outputFileId"]) {
    const value = ctx.params[key];
    if (typeof value === "string" && value.length > 0) {
      const file = rawQuery<{ owner_id: string }>(
        db,
        "SELECT owner_id FROM files WHERE id = ? AND deleted_at IS NULL",
        value,
      )[0];
      if (!file) return { allowed: false, reason: `file ${value} not found` };
      if (file.owner_id !== ctx.userId && !ctx.roles.includes("admin")) {
        return {
          allowed: false,
          reason: `file ${value} not accessible to user (ACL)`,
        };
      }
    }
  }

  // 4. Egress allowlist for http tools.
  if (ctx.toolId.startsWith("http.")) {
    const target = typeof ctx.params.url === "string" ? ctx.params.url : "";
    const allow = options?.egressAllowlist ?? [];
    const hostMatches = allow.some((allowed) => {
      try {
        return new URL(target).host === allowed;
      } catch {
        return false;
      }
    });
    if (!hostMatches) {
      return {
        allowed: false,
        reason: `egress target not in release allowlist: ${target.slice(0, 80)}`,
      };
    }
  }

  return { allowed: true };
}


/** Audited check: every denial leaves a trail (FR-09.7). */
export async function checkToolCall(
  db: ForgegentDb,
  ctx: ToolCallContext,
  options?: GatewayOptions,
): Promise<GatewayDecision> {
  const decision = await check(db, ctx, options);
  if (!decision.allowed) {
    await audit(db, {
      actorId: ctx.userId,
      action: `tool.invoke:${ctx.toolId}`,
      resourceType: "task",
      resourceId: ctx.taskId,
      decision: "deny",
      reason: decision.reason,
      payload: { params: ctx.params },
    });
  }
  return decision;
}

/**
 * Wrap a raw tool executor with the gateway (design D5): the wrapper runs
 * BEFORE any side effect — forged parameters die at the gate (AT-18).
 */
export function withGateway(
  db: ForgegentDb,
  ctx: Omit<ToolCallContext, "params">,
  execute: (params: Record<string, unknown>) => Promise<string>,
  options?: GatewayOptions,
): (params: Record<string, unknown>) => Promise<string> {
  return async (params: Record<string, unknown>) => {
    const decision = await checkToolCall(db, { ...ctx, params }, options);
    if (!decision.allowed) {
      return `gateway-deny: ${decision.reason}`;
    }
    return execute(params);
  };
}
