import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  auditDockerSecurity,
  buildDockerRunArgs,
  LocalProcessBackend,
  SandboxManager,
} from "../src/index.js";

const tmpRoots: string[] = [];
function mktmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });
});

describe("execution backend contract (task 7.1)", () => {
  it("local backend: per-session workspaces with cleaned env", async () => {
    const backend = new LocalProcessBackend(mktmp("be-root-"));
    const handle = await backend.acquireSession("sess-contract");
    expect(handle.workspaceDir).toContain("s-sess-con");
    const result = await backend.runInSession(handle, [
      "sh",
      "-c",
      'echo "cwd=$(pwd) hasKey=${FORGEGENT_API_KEY:-none}"',
    ]);
    // Host env (incl. any secrets) never reaches the sandbox process.
    expect(result.stdout).toContain("hasKey=none");
    expect(result.exitCode).toBe(0);
    await backend.destroySession(handle);
  });

  it("manager contract: acquire/run/release/restore across backends", async () => {
    const persistRoot = mktmp("be-persist-");
    const backend = new LocalProcessBackend(mktmp("be-root2-"));
    const manager = new SandboxManager(backend, persistRoot);
    const handle = await manager.acquire("sess-a");
    writeFileSync(join(handle.workspaceDir, "state.txt"), "session-state");
    await manager.teardown("sess-a");
    expect(manager.has("sess-a")).toBe(false);
    // Next acquire restores the persisted workspace (AT-14).
    const reborn = await manager.acquire("sess-a");
    expect(readFileSync(join(reborn.workspaceDir, "state.txt"), "utf-8")).toBe(
      "session-state",
    );
  });
});

describe("session lifecycle (task 7.2 — reuse & idle recycle)", () => {
  it("reuses the same handle within the idle window", async () => {
    const backend = new LocalProcessBackend(mktmp("lc-root-"));
    const reused: string[] = [];
    const manager = new SandboxManager(
      backend,
      mktmp("lc-persist-"),
      { onReuse: (id) => reused.push(id) },
      15 * 60 * 1000,
    );
    const h1 = await manager.acquire("sess-reuse");
    const h2 = await manager.acquire("sess-reuse");
    expect(h1.handleId).toBe(h2.handleId);
    expect(reused).toEqual(["sess-reuse"]);
  });

  it("recycles after 15 idle minutes, persisting first", async () => {
    const backend = new LocalProcessBackend(mktmp("lc-root2-"));
    const recycled: { id: string; dir: string }[] = [];
    let clock = 1_000_000;
    const manager = new SandboxManager(
      backend,
      mktmp("lc-persist2-"),
      { onRecycle: (id, dir) => recycled.push({ id, dir }) },
      15 * 60 * 1000,
      () => clock,
    );
    const handle = await manager.acquire("sess-idle");
    writeFileSync(join(handle.workspaceDir, "artifact.txt"), "keep-me");
    expect(await manager.sweepIdle()).toEqual([]); // not idle yet
    clock += 16 * 60 * 1000;
    expect(await manager.sweepIdle()).toEqual(["sess-idle"]);
    expect(recycled).toHaveLength(1);
    expect(existsSync(join(recycled[0]!.dir, "artifact.txt"))).toBe(true);
    expect(manager.has("sess-idle")).toBe(false);
  });

  it("recycle→acquire restores files without cross-session leakage (AT-14)", async () => {
    const persistRoot = mktmp("lc-persist3-");
    const backend = new LocalProcessBackend(mktmp("lc-root3-"));
    const manager = new SandboxManager(backend, persistRoot);
    const mine = await manager.acquire("sess-mine");
    const theirs = await manager.acquire("sess-theirs");
    writeFileSync(join(mine.workspaceDir, "mine.txt"), "mine");
    writeFileSync(join(theirs.workspaceDir, "theirs.txt"), "theirs");
    await manager.teardown("sess-mine");
    await manager.teardown("sess-theirs");
    // Reborn "mine" sees only its own persisted files.
    const reborn = await manager.acquire("sess-mine");
    expect(existsSync(join(reborn.workspaceDir, "mine.txt"))).toBe(true);
    expect(existsSync(join(reborn.workspaceDir, "theirs.txt"))).toBe(false);
  });
});

describe("docker security args (task 7.3 — AT-16)", () => {
  const spec = {
    image: "forgegent/sandbox:1",
    name: "sbx-test",
    workspaceHostDir: "/data/sandboxes/s-123",
    limits: { memoryMb: 512, cpus: 1, egressHosts: [], timeoutMs: 60_000 },
    env: { FORGEGENT_PROXY_URL: "http://forgegent-proxy:8788", FORGEGENT_SANDBOX_TOKEN: "opaque-session-token" },
    proxyHost: "172.17.0.1",
    command: ["node", "agent.js"],
  };

  it("hardens every dimension and never mounts the socket/secrets", () => {
    const args = buildDockerRunArgs(spec);
    expect(args).toContain("--user");
    expect(args[args.indexOf("--user") + 1]).toBe("65534:65534");
    expect(args).toContain("--cap-drop");
    expect(args[args.indexOf("--cap-drop") + 1]).toBe("ALL");
    expect(args).toContain("no-new-privileges");
    expect(args).toContain("--memory");
    expect(args.join(" ")).not.toContain("docker.sock");
    expect(args.join(" ")).not.toContain("sk-");

    const violations = auditDockerSecurity({
      mounts: args
        .filter((_, i, all) => all[i - 1] === "-v"),
      env: spec.env,
      capDropAll: true,
      nonRootUser: true,
      noNewPrivileges: true,
      resourceLimits: true,
    });
    expect(violations).toEqual([]);
  });

  it("the auditor itself catches violations (metatest)", () => {
    const violations = auditDockerSecurity({
      mounts: ["/var/run/docker.sock:/var/run/docker.sock", "/:/host"],
      env: { OPENAI_API_KEY: "sk-live-secret" },
      capDropAll: false,
      nonRootUser: false,
      noNewPrivileges: false,
      resourceLimits: false,
    });
    expect(violations.some((v) => v.includes("docker socket"))).toBe(true);
    expect(violations.some((v) => v.includes("broad host path"))).toBe(true);
    expect(violations.some((v) => v.includes("secret-shaped"))).toBe(true);
  });
});
