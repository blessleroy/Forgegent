/**
 * Runner scheduling loop (task 2.1; design D3).
 *
 * Single-process scheduler over the SQLite lease queue:
 * - every tick: reclaim stale leases (crashed peers -> interrupted), then
 *   claim tasks while below the concurrency cap;
 * - one in-flight task per session is guaranteed by the queue primitive;
 * - handler result maps to the terminal state; throw -> failed.
 */
import { newLeaseOwnerId, type ClaimedTask } from "@forgegent/db";

export interface SchedulerConfig {
  pollIntervalMs: number;
  maxConcurrency: number;
  leaseSeconds: number;
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  pollIntervalMs: Number(process.env.FORGEGENT_POLL_INTERVAL_MS ?? 2000),
  maxConcurrency: Number(process.env.FORGEGENT_MAX_CONCURRENCY ?? 5),
  leaseSeconds: Number(process.env.FORGEGENT_LEASE_SECONDS ?? 120),
};

/** Execution outcome the handler reports (state machine terminal states). */
export type HandlerOutcome = "completed" | "failed" | "waiting_input";

export type TaskHandler = (task: ClaimedTask) => Promise<HandlerOutcome>;

/** Queue operations with the database already bound (closure-injected). */
export interface SchedulerDeps {
  claim(owner: string, leaseSeconds: number): ClaimedTask | null;
  finish(
    taskId: string,
    owner: string,
    state: "completed" | "failed" | "cancelled" | "interrupted" | "running" | "waiting_input",
  ): boolean;
  reclaim(): string[];
  /** Remediation 2.13: keep long runs leased (renewLease) — optional so
   *  test doubles keep working without it. */
  renew?(taskId: string, owner: string, leaseSeconds: number): boolean;
}

export class Scheduler {
  private readonly owner = newLeaseOwnerId();
  private readonly active = new Map<string, Promise<void>>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(
    private readonly deps: SchedulerDeps,
    private readonly handler: TaskHandler,
    private readonly config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG,
  ) {}

  get activeCount(): number {
    return this.active.size;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One scheduling pass; also the unit-test entry point. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      this.deps.reclaim();
      // Fill every free slot, then wait for ANY completion before refilling
      // (2.13): a fast task finishing never idles a slot until its slow
      // siblings settle. The loop drains the queue within one tick.
      for (;;) {
        while (this.active.size < this.config.maxConcurrency) {
          const task = this.deps.claim(this.owner, this.config.leaseSeconds);
          if (!task) break;
          const run = this.execute(task).finally(() => {
            this.active.delete(task.id);
          });
          this.active.set(task.id, run);
          void run.catch(() => undefined);
        }
        if (this.active.size === 0) break;
        await Promise.race([...this.active.values()]);
      }
    } finally {
      this.ticking = false;
    }
  }

  private async execute(task: ClaimedTask): Promise<void> {
    // Self-renewal (2.13): the lease outlives reclaim sweeps for as long as
    // the run is genuinely alive — a long task is never interrupted by its
    // own lease expiring.
    const renewTimer =
      this.deps.renew &&
      setInterval(() => {
        this.deps.renew!(task.id, this.owner, this.config.leaseSeconds);
      }, Math.max(1, Math.floor((this.config.leaseSeconds * 1000) / 2)));
    let outcome: HandlerOutcome;
    try {
      outcome = await this.handler(task);
    } catch {
      outcome = "failed";
    } finally {
      if (renewTimer) clearInterval(renewTimer);
    }
    this.deps.finish(task.id, this.owner, outcome);
  }
}
