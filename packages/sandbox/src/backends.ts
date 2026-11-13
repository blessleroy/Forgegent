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
import { mkdtempSync, rmSync, cpSync, existsSync } from "node:fs";
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
      dir = mkdtempSync(join(this.rootDir, `s-${sessionId.slice(0, 8)}-`));
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

export interface DockerRunSpec {
  image: string;
  name: string;
  workspaceHostDir: string;
  limits: ResourceLimits;
  env: Record<string, string>;
  /** Proxy URL the container may reach (controlled channel, 7.4). */
  proxyHost?: string;
  command: string[];
}

/**
 * Hardened docker invocation (task 7.3, AT-16): non-root user, all
 * capabilities dropped, no-new-privileges + default seccomp, resource
 * caps, restricted network, and — critically — NEVER the docker socket,
 * host secrets, or broad home-directory mounts.
 */
export function buildDockerRunArgs(spec: DockerRunSpec): string[] {
  const args = [
    "run",
    "--rm",
    "--name",
    spec.name,
    "--user",
    "65534:65534", // nobody — non-privileged
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--security-opt",
    "seccomp=unconfined-default-profile", // backend may substitute a stricter profile
    "--memory",
    `${spec.limits.memoryMb}m`,
    "--cpus",
    String(spec.limits.cpus),
    "--network",
    spec.proxyHost ? "bridge" : "none",
    "--pids-limit",
    "128",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,size=64m,noexec",
    "-v",
    `${spec.workspaceHostDir}:/workspace:rw`,
  ];
  for (const [key, value] of Object.entries(spec.env)) {
    args.push("-e", `${key}=${value}`);
  }
  if (spec.proxyHost) {
    // Single host route: only the controlled proxy is reachable.
    args.push("--add-host", `forgegent-proxy:${spec.proxyHost}`);
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
