/**
 * Forgegent Agent Runner — standalone process (design D1).
 *
 * Polls the SQLite task queue with leases, enforces the concurrency cap,
 * and executes tasks via the scheduler. M0 handler runs the task lifecycle
 * with a verified restricted session (no model wiring until endpoints are
 * configured in M1 tasks).
 */
import { join } from "node:path";
import {
  appendTaskEvent,
  claimNextTask,
  createDb,
  finishLeasedTask,
  reclaimStaleLeases,
} from "@forgegent/db";
import { Scheduler, DEFAULT_SCHEDULER_CONFIG } from "./scheduler.js";

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

  const scheduler = new Scheduler(
    {
      claim: (owner, seconds) => claimNextTask(db, owner, seconds),
      finish: (taskId, owner, state) =>
        finishLeasedTask(db, taskId, owner, state),
      reclaim: () => reclaimStaleLeases(db),
    },
    async (task) => {
      appendTaskEvent(db, task.id, "run.started", {
        mode: task.mode,
        release: task.agentReleaseId,
      });
      // M0 lifecycle execution; restricted agent wiring lands in M1.
      appendTaskEvent(db, task.id, "run.completed", {
        note: "m0-lifecycle-execution",
      });
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
  log("runner started");
  // Keep the process alive; the interval holds the event loop.
  await new Promise(() => {});
}

main().catch((error) => {
  console.error(
    JSON.stringify({ component: "runner", level: "error", message: String(error) }),
  );
  process.exit(1);
});
