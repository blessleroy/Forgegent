/**
 * Forgegent Agent Runner — standalone process (design D1).
 *
 * F1: the scheduler executes tasks through the REAL agent loop —
 * gateway-wrapped tools, pi session prompt, real artifact write-back,
 * session_refs persistence, deadline/cancel guards.
 *
 * R3 (D36/D38): sandboxed tasks run untrusted commands through a per-task
 * Docker session (internal network, controlled proxy as the only egress,
 * host-side model key). The Pi orchestration loop stays on the host. When
 * the docker daemon is unreachable the channel reports unavailable and
 * sandboxed tasks fail with a structured reason — restricted tasks are
 * unaffected.
 */
import { join } from "node:path";
import {
  claimNextTask,
  createDb,
  finishLeasedTask,
  logJson,
  rawQuery,
  reclaimStaleLeases,
  renewLease,
} from "@forgegent/db";
import {
  ControlledProxy,
  DockerBackend,
  SandboxManager,
} from "@forgegent/sandbox";
import { Scheduler, DEFAULT_SCHEDULER_CONFIG } from "./scheduler.js";
import { executeGuardedTask } from "./guards.js";
import {
  createProductionDeps,
  executeRestrictedTask,
  resolveModelEndpoint,
  type SandboxChannel,
  type SandboxRunnerHandle,
} from "./executor.js";

/** R4.4: production logging goes through logJson (redact-wrapped) — no
 *  unredacted console path in the runner. */
function log(message: string, fields?: Record<string, unknown>): void {
  console.log(logJson("runner", "info", message, fields));
}

function dataDir(): string {
  return process.env.FORGEGENT_DATA_DIR ?? join(process.cwd(), "data");
}

/**
 * Build the sandbox channel (3.3/3.4): DockerBackend on an internal network
 * + controlled proxy + idle sweep. Returns available:false when the daemon
 * is unreachable (degradation path, D36).
 */
async function buildSandboxChannel(
  db: ReturnType<typeof createDb>,
  workspaceRoot: string,
): Promise<SandboxChannel> {
  const image = process.env.FORGEGENT_SANDBOX_IMAGE ?? "forgegent-sandbox:1";
  const network = process.env.FORGEGENT_SANDBOX_NETWORK ?? "forgegent-internal";
  const proxyPort = Number(process.env.FORGEGENT_PROXY_PORT ?? 8788);
  const backend = new DockerBackend({
    image,
    network,
    rootDir: join(dataDir(), "sandbox-workspaces"),
  });
  const daemonUp = await backend.available();
  if (!daemonUp) {
    return {
      available: false,
      unavailableReason:
        "docker daemon 不可达 — 检查 Rootless Docker socket 挂载（FORGEGENT_DOCKER_SOCKET）；sandboxed 任务将失败，restricted 任务不受影响",
      acquireForTask: async () => {
        throw new Error("sandbox channel unavailable");
      },
      teardownTask: async () => undefined,
    };
  }
  const manager = new SandboxManager(backend, join(dataDir(), "sandbox-persist"), {
    onRecycle: (sessionId) => log("sandbox recycled (idle)", { sessionId }),
  });
  // Controlled proxy (3.2): model passthrough (host-side key) + per-token
  // whitelist forwarding for sandbox egress.
  const endpoint = resolveModelEndpoint(db);
  const upstreamKey = endpoint ? process.env[endpoint.apiKeyEnv] ?? "" : "";
  const proxy = new ControlledProxy({
    port: proxyPort,
    host: "0.0.0.0",
    upstreamBaseUrl: endpoint?.baseUrl,
    upstreamApiKey: upstreamKey || undefined,
  });
  await proxy.start();
  const sandboxProxyUrl =
    process.env.FORGEGENT_SANDBOX_PROXY_URL ?? `http://runner:${proxyPort}`;
  const runners = new Map<string, SandboxRunnerHandle>();
  log("sandbox channel ready", { image, network, proxyPort, sandboxProxyUrl });
  return {
    available: true,
    async acquireForTask({ taskId, sessionId, egressHosts }) {
      const existing = runners.get(taskId);
      if (existing) return existing;
      const sessionKey = sessionId ?? `task-${taskId}`;
      const token = proxy.issueToken(egressHosts);
      const handle = await manager.acquire(sessionKey, {
        workspaceHostDir: join(workspaceRoot, "work", taskId),
        env: {
          FORGEGENT_PROXY_URL: sandboxProxyUrl,
          FORGEGENT_SANDBOX_TOKEN: token,
        },
      });
      const runner: SandboxRunnerHandle = {
        async exec(command, timeoutMs) {
          const result = await backend.runInSession(
            handle,
            ["/bin/sh", "-c", command],
            { memoryMb: 512, cpus: 1, egressHosts, timeoutMs },
          );
          return {
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
          };
        },
        async teardown() {
          runners.delete(taskId);
          await manager.teardown(sessionKey);
          proxy.revokeToken(token);
        },
      };
      runners.set(taskId, runner);
      return runner;
    },
    async teardownTask(taskId) {
      const runner = runners.get(taskId);
      if (runner) await runner.teardown();
    },
    async sweepIdle() {
      // Waiting-task sandboxes whose employees never reply are recycled
      // here (persist intrinsic — the workspace is a host directory).
      return manager.sweepIdle();
    },
  };
}

async function main(): Promise<void> {
  const db = createDb(join(dataDir(), "forgegent.sqlite"));
  log("runner starting", { ...DEFAULT_SCHEDULER_CONFIG, dataDir: dataDir() });

  const workspaceRoot = join(dataDir(), "runner");
  // Task 1.1: one artifact root shared with the web file API (`<dataDir>/files`).
  // Task 2.6: the shared SkillStore root (release-pinned, hash-verified).
  const deps = createProductionDeps(
    db,
    workspaceRoot,
    join(dataDir(), "files"),
    join(dataDir(), "skills"),
  );
  // R3: the sandbox channel (degrades to unavailable, never crashes the
  // runner — restricted tasks must keep flowing).
  const sandbox = await buildSandboxChannel(db, workspaceRoot);
  deps.sandbox = sandbox;
  if (!sandbox.available) {
    log("sandbox unavailable — sandboxed tasks will fail structurally", {
      reason: sandbox.unavailableReason,
    });
  }

  const scheduler = new Scheduler(
    {
      claim: (owner, seconds) => claimNextTask(db, owner, seconds),
      finish: (taskId, owner, state) =>
        finishLeasedTask(db, taskId, owner, state),
      reclaim: () => reclaimStaleLeases(db),
      renew: (taskId, owner, seconds) => renewLease(db, taskId, owner, seconds),
    },
    async (task) => {
      const leaseOwner = rawQuery<{ lease_owner: string }>(
        db,
        "SELECT lease_owner FROM tasks WHERE id = ?",
        task.id,
      )[0]?.lease_owner ?? "runner";
      // R4.3: per-task duration budget tightens the env-level timeout
      // (execution-time enforcement, not post-hoc).
      const envTimeoutMs = Number(process.env.FORGEGENT_TASK_TIMEOUT_MS ?? 300_000);
      let budgetMs = 0;
      try {
        const budget =
          typeof task.budget === "string"
            ? (JSON.parse(task.budget) as { maxDurationSeconds?: number })
            : null;
        budgetMs = Number(budget?.maxDurationSeconds ?? 0) * 1000;
      } catch {
        /* malformed budget — env timeout applies */
      }
      await executeGuardedTask(db, task, leaseOwner, {
        timeoutMs: budgetMs > 0 ? Math.min(envTimeoutMs, budgetMs) : envTimeoutMs,
        run: async (signal) => {
          const snapshotStore = new (
            await import("@forgegent/registry")
          ).ReleaseStore(join(dataDir(), "releases"));
          return executeRestrictedTask(db, snapshotStore, task, deps, { signal });
        },
      });
      // R3.4: keep the sandbox alive across waiting_input rounds; tear down
      // on every other exit (idle sweep is the backstop for waiting tasks).
      if (sandbox.available) {
        const finalState = rawQuery<{ state: string }>(
          db,
          "SELECT state FROM tasks WHERE id = ?",
          task.id,
        )[0]?.state;
        if (finalState !== "waiting_input") {
          await sandbox.teardownTask(task.id).catch(() => undefined);
        }
      }
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
  // R3.4: idle sandbox sweep (15-minute default inside the manager).
  if (sandbox.sweepIdle) {
    const sweepTimer = setInterval(() => {
      void sandbox.sweepIdle!().catch(() => undefined);
    }, 60_000);
    sweepTimer.unref?.();
  }
  log("runner started (production executor)", {
    sandbox: sandbox.available ? "docker" : "unavailable",
  });
  await new Promise(() => {});
}

main().catch((error) => {
  console.error(
    JSON.stringify({ component: "runner", level: "error", message: String(error) }),
  );
  process.exit(1);
});
