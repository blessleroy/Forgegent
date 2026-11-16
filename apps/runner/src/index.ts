/**
 * Forgegent Agent Runner — standalone process (design D1).
 *
 * F1: the scheduler now executes tasks through the REAL agent loop —
 * gateway-wrapped tools, pi session prompt, real artifact write-back,
 * session_refs persistence, deadline/cancel guards.
 */
import { join } from "node:path";
import {
  claimNextTask,
  createDb,
  finishLeasedTask,
  rawQuery,
  reclaimStaleLeases,
} from "@forgegent/db";
import { Scheduler, DEFAULT_SCHEDULER_CONFIG } from "./scheduler.js";
import { executeGuardedTask } from "./guards.js";
import { createProductionDeps, executeRestrictedTask } from "./executor.js";

function log(message: string, fields?: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      component: "runner",
      message,
      ...fields,
    }),
  );
}

function dataDir(): string {
  return process.env.FORGEGENT_DATA_DIR ?? join(process.cwd(), "data");
}

async function main(): Promise<void> {
  const db = createDb(join(dataDir(), "forgegent.sqlite"));
  log("runner starting", { ...DEFAULT_SCHEDULER_CONFIG, dataDir: dataDir() });

  const workspaceRoot = join(dataDir(), "runner");
  const deps = createProductionDeps(db, workspaceRoot);

  const scheduler = new Scheduler(
    {
      claim: (owner, seconds) => claimNextTask(db, owner, seconds),
      finish: (taskId, owner, state) =>
        finishLeasedTask(db, taskId, owner, state),
      reclaim: () => reclaimStaleLeases(db),
    },
    async (task) => {
      const leaseOwner = rawQuery<{ lease_owner: string }>(
        db,
        "SELECT lease_owner FROM tasks WHERE id = ?",
        task.id,
      )[0]?.lease_owner ?? "runner";
      await executeGuardedTask(db, task, leaseOwner, {
        timeoutMs: Number(process.env.FORGEGENT_TASK_TIMEOUT_MS ?? 300_000),
        run: async () => {
          const snapshotStore = new (
            await import("@forgegent/registry")
          ).ReleaseStore(join(dataDir(), "releases"));
          return executeRestrictedTask(db, snapshotStore, task, deps);
        },
      });
      // Final state from the DB (executeGuardedTask already closed the lease).
      const state = rawQuery<{ state: string }>(
        db,
        "SELECT state FROM tasks WHERE id = ?",
        task.id,
      )[0]?.state;
      log("task executed", { taskId: task.id, state });
      // Scheduler finish is a no-op once the lease is closed; map to a
      // benign outcome for the scheduler bookkeeping.
      return "completed";
    },
    DEFAULT_SCHEDULER_CONFIG,
  );

  const shutdown = (): void => {
    log("runner stopping");
    scheduler.stop();
    setTimeout(() => process.exit(0), 500);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  scheduler.start();
  log("runner started (production executor)");
  await new Promise(() => {});
}

main().catch((error) => {
  console.error(
    JSON.stringify({ component: "runner", level: "error", message: String(error) }),
  );
  process.exit(1);
});
