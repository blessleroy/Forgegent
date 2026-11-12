/**
 * Forgegent Agent Runner — entry point placeholder (task 1.1).
 *
 * Target shape (design.md D1, tasks 2.1): a standalone Node process that
 * polls the SQLite task table with leases, enforces the concurrency limit,
 * and executes tasks in restricted or sandboxed mode via @forgegent/pi-adapter.
 */

const POLL_INTERVAL_MS = Number(process.env.FORGEGENT_POLL_INTERVAL_MS ?? 2000);
const MAX_CONCURRENCY = Number(process.env.FORGEGENT_MAX_CONCURRENCY ?? 5);

let running = true;

function log(message: string): void {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      component: "runner",
      message,
      pollIntervalMs: POLL_INTERVAL_MS,
      maxConcurrency: MAX_CONCURRENCY,
    }),
  );
}

async function main(): Promise<void> {
  log("runner starting (skeleton; task polling arrives in task 2.1)");
  process.on("SIGINT", () => {
    running = false;
  });
  process.on("SIGTERM", () => {
    running = false;
  });
  while (running) {
    // Task lease polling loop lands with task 2.1 (SQLite queue).
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  log("runner stopped");
}

main().catch((error) => {
  console.error(JSON.stringify({ component: "runner", level: "error", message: String(error) }));
  process.exit(1);
});
