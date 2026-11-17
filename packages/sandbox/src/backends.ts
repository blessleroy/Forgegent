/**
 * Execution backend abstraction (task 7.1, sandbox-isolation spec).
 *
 * The platform never talks to a concrete runtime directly: the sandbox
 * manager depends on this interface. Default implementation is Rootless
 * Docker (per-session containers); a local process backend serves
 * development and tests; gVisor/MicroVM adapters can be added later by
 * implementing the same contract (FR-08.3).
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, cpSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface SessionHandle {
  /** Working-session identifier (task session reuse key). */
  sessionId: string;
  handleId: string;
  workspaceDir: string;
}

export interface AcquireOptions {
  /** Directory whose contents are restored into the fresh workspace. */
  restoreFromDir?: string;
  /**
   * Remediation 3.3: mount THIS host directory as the sandbox workspace
   * (the task's own workspace — skills/scripts/inputs are visible inside
   * the container; Docker backend). LocalProcess backends copy it in.
   */
  workspaceHostDir?: string;
  /** Env visible inside the sandbox (never secrets — proxy URLs/tokens). */
  env?: Record<string, string>;
}

export interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface ResourceLimits {
  memoryMb: number;
  cpus: number;
  /** Allowed egress hosts (enforced by the backend network policy). */
  egressHosts: string[];
  timeoutMs: number;
}

export const DEFAULT_LIMITS: ResourceLimits = {
  memoryMb: 512,
  cpus: 1,
  egressHosts: [],
  timeoutMs: 120_000,
};

export interface ExecutionBackend {
  readonly kind: string;
  acquireSession(
    sessionId: string,
    options?: AcquireOptions,
    limits?: ResourceLimits,
  ): Promise<SessionHandle>;
  runInSession(
    handle: SessionHandle,
    command: string[],
    limits?: ResourceLimits,
  ): Promise<RunResult>;
  /** Persist the workspace to the given dir, then destroy the session. */
  releaseSession(handle: SessionHandle, persistDir: string): Promise<void>;
  destroySession(handle: SessionHandle): Promise<void>;
}

let handleCounter = 0;

/** Local process backend: per-session temp workspaces, no host secrets. */
export class LocalProcessBackend implements ExecutionBackend {
  readonly kind = "local-process";
  private readonly workspaces = new Map<string, string>();

  constructor(private readonly rootDir = join(tmpdir(), "forgegent-sandbox")) {}

  async acquireSession(
    sessionId: string,
    options?: AcquireOptions,
  ): Promise<SessionHandle> {
    let dir = this.workspaces.get(sessionId);
    if (!dir) {
      dir = options?.workspaceHostDir ?? mkdtempSync(join(this.rootDir, `s-${sessionId.slice(0, 8)}-`));
      this.workspaces.set(sessionId, dir);
      if (options?.restoreFromDir && existsSync(options.restoreFromDir)) {
        cpSync(options.restoreFromDir, dir, { recursive: true });
      }
    }
    handleCounter += 1;
    return {
      sessionId,
      handleId: `local-${handleCounter}`,
      workspaceDir: dir,
    };
  }

  async runInSession(
    handle: SessionHandle,
    command: string[],
    limits?: ResourceLimits,
  ): Promise<RunResult> {
    const timeoutMs = limits?.timeoutMs ?? DEFAULT_LIMITS.timeoutMs;
    return new Promise((resolve) => {
      const child = spawn(command[0]!, command.slice(1), {
        cwd: handle.workspaceDir,
        // Only explicitly provided env — no host secrets leak in.
        env: { PATH: "/usr/bin:/bin", ...{} },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ exitCode: code, stdout, stderr });
      });
    });
  }

  async releaseSession(handle: SessionHandle, persistDir: string): Promise<void> {
    cpSync(handle.workspaceDir, persistDir, { recursive: true });
    await this.destroySession(handle);
  }

  async destroySession(handle: SessionHandle): Promise<void> {
    const dir = this.workspaces.get(handle.sessionId);
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      this.workspaces.delete(handle.sessionId);
    }
  }
}

/* ------------------------ docker argument builder ------------------------ */

/* --------------------------- docker backend (3.1) --------------------------- */

export interface DockerBackendOptions {
  /** Sandbox image (prebuilt — never pulled per task, FR-08). */
  image: string;
  /**
   * Internal network name with no external route; the only reachable peer
   * is the platform's controlled proxy (D36). Omit for fully-offline
   * (`--network none`) sandboxes.
   */
  network?: string;
  /** docker binary (default "docker"; tests inject a fake). */
  binary?: string;
  /** Host-side root for per-session workspace dirs. */
  rootDir?: string;
}

interface ExecOutcome {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Rootless-Docker backend (remediation 3.1): one detached keep-alive
 * container per work session; the workspace is a HOST directory mounted at
 * /workspace, so persistence and restore are intrinsic (AT-14) — recycling
 * only removes the container, never the workspace. Commands run via
 * `docker exec`; the container has no production credentials (the proxy
 * token is short-lived and non-secret).
 */
export class DockerBackend implements ExecutionBackend {
  readonly kind = "docker";
  private readonly workspaces = new Map<string, string>();
  private readonly containers = new Map<string, string>();

  constructor(private readonly options: DockerBackendOptions) {}

  /** Availability probe (degradation path: sandboxed tasks fail with a
   *  structured reason when the daemon/socket is unreachable, D36). */
  async available(): Promise<boolean> {
    try {
      const outcome = await this.exec(["version", "--format", "{{.Server.Version}}"], 5000);
      return outcome.code === 0 && outcome.stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  private async exec(args: string[], timeoutMs: number): Promise<ExecOutcome> {
    return new Promise((resolve) => {
      const child = spawn(this.options.binary ?? "docker", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({ code: null, stdout, stderr: `${stderr}${String(error)}` });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });
  }

  private rootDir(): string {
    return this.options.rootDir ?? join(tmpdir(), "forgegent-sandboxes");
  }

  async acquireSession(
    sessionId: string,
    options?: AcquireOptions,
    limits?: ResourceLimits,
  ): Promise<SessionHandle> {
    let dir = this.workspaces.get(sessionId);
    if (!dir) {
      // 3.3: the sandbox workspace IS the task workspace when provided —
      // skills/scripts/inputs are visible inside the container by mount.
      dir =
        options?.workspaceHostDir ??
        join(this.rootDir(), `s-${sessionId.slice(0, 12)}-${crypto.randomUUID().slice(0, 6)}`);
      mkdirSync(dir, { recursive: true });
      this.workspaces.set(sessionId, dir);
    }
    const name = `forgegent-sbx-${sessionId.slice(0, 20).replace(/[^a-zA-Z0-9_.-]/g, "_")}`;
    const effectiveLimits = limits ?? DEFAULT_LIMITS;
    if (!this.containers.has(sessionId)) {
      const args = buildDockerRunArgs({
        image: this.options.image,
        name,
        workspaceHostDir: dir,
        limits: effectiveLimits,
        env: options?.env ?? {},
        network: this.options.network,
        detach: true,
        command: ["sleep", "infinity"],
      });
      const outcome = await this.exec(args, 60_000);
      if (outcome.code !== 0) {
        throw new Error(
          `sandbox container start failed: ${outcome.stderr.trim().slice(0, 200)}`,
        );
      }
      this.containers.set(sessionId, name);
    }
    handleCounter += 1;
    return { sessionId, handleId: `docker-${handleCounter}`, workspaceDir: dir };
  }

  async runInSession(
    handle: SessionHandle,
    command: string[],
    limits?: ResourceLimits,
  ): Promise<RunResult> {
    const name = this.containers.get(handle.sessionId);
    if (!name) throw new Error("sandbox session not acquired");
    const timeoutMs = limits?.timeoutMs ?? DEFAULT_LIMITS.timeoutMs;
    const outcome = await this.exec(
      ["exec", "-w", "/workspace", name, ...command],
      timeoutMs,
    );
    return { exitCode: outcome.code, stdout: outcome.stdout, stderr: outcome.stderr };
  }

  async releaseSession(handle: SessionHandle, persistDir: string): Promise<void> {
    // The workspace IS a host directory — persistence is intrinsic; just
    // remove the container (multi-round reuse keeps the same workspace).
    await this.destroySession(handle);
    void persistDir;
  }

  async destroySession(handle: SessionHandle): Promise<void> {
    const name = this.containers.get(handle.sessionId);
    if (name) {
      await this.exec(["rm", "-f", name], 30_000);
      this.containers.delete(handle.sessionId);
    }
    // Workspaces survive recycling by design (AT-14 restore-on-acquire).
  }
}

export interface DockerRunSpec {
  image: string;
  name: string;
  workspaceHostDir: string;
  limits: ResourceLimits;
  env: Record<string, string>;
  /**
   * Egress topology (D36): either "none" (fully offline) or the name of a
   * Docker network with NO external route (internal bridge) whose only
   * reachable member is the platform's controlled proxy. A DNS record is
   * NEVER an egress filter — the previous `--add-host` approach is removed.
   */
  network?: string;
  /** Detached keep-alive container (session reuse) vs one-shot run. */
  detach?: boolean;
  command: string[];
}

/**
 * Hardened docker invocation (task 7.3 + remediation 3.1, AT-16): non-root
 * user, all capabilities dropped, no-new-privileges + docker's DEFAULT
 * seccomp profile (unmodified — the previous custom value was not a legal
 * docker CLI argument), resource caps, network topology as above, and —
 * critically — NEVER the docker socket, host secrets, or broad
 * home-directory mounts.
 */
export function buildDockerRunArgs(spec: DockerRunSpec): string[] {
  const args = [
    "run",
    spec.detach ? "--detach" : "--rm",
    "--name",
    spec.name,
    "--user",
    "65534:65534", // nobody — non-privileged
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    // docker's own default seccomp profile applies (no override value).
    "--memory",
    `${spec.limits.memoryMb}m`,
    "--cpus",
    String(spec.limits.cpus),
    "--network",
    spec.network ?? "none",
    "--pids-limit",
    "128",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,size=64m,noexec",
    "-v",
    `${spec.workspaceHostDir}:/workspace:rw`,
    "-w",
    "/workspace",
  ];
  for (const [key, value] of Object.entries(spec.env)) {
    args.push("-e", `${key}=${value}`);
  }
  args.push(spec.image, ...spec.command);
  return args;
}

/** Key names the platform itself injects as short-lived channel tokens
 *  (not production secrets — the proxy holds the real key host-side). */
const PLATFORM_TOKEN_KEYS = /^FORGEGENT_(PROXY_URL|SANDBOX_TOKEN)$/;

/** Security invariants checked in tests (AT-16). */
export function auditDockerSecurity(spec: DockerRunArgsAuditable): string[] {
  const violations: string[] = [];
  for (const mount of spec.mounts) {
    if (/docker\.sock|\/var\/run\/docker/.test(mount)) {
      violations.push(`docker socket mounted: ${mount}`);
    }
    if (/^\/$|^\/home|^\/Users|^\/etc\/docker/.test(mount.split(":")[0] ?? "")) {
      violations.push(`broad host path mounted: ${mount}`);
    }
  }
  for (const [key, value] of Object.entries(spec.env)) {
    if (PLATFORM_TOKEN_KEYS.test(key)) continue;
    if (/key|secret|token|password/i.test(key)) {
      violations.push(`secret-shaped env leaked: ${key}`);
    }
    if (/^sk-|Bearer\s/i.test(value)) {
      violations.push(`credential-shaped value leaked via ${key}`);
    }
  }
  if (!spec.capDropAll) violations.push("capabilities not fully dropped");
  if (!spec.nonRootUser) violations.push("container runs as root");
  if (!spec.noNewPrivileges) violations.push("no-new-privileges missing");
  if (!spec.resourceLimits) violations.push("resource limits missing");
  return violations;
}

export interface DockerRunArgsAuditable {
  mounts: string[];
  env: Record<string, string>;
  capDropAll: boolean;
  nonRootUser: boolean;
  noNewPrivileges: boolean;
  resourceLimits: boolean;
}
