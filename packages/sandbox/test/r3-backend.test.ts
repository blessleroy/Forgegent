/**
 * R3 3.1/3.2 regressions:
 * - buildDockerRunArgs v2: internal-network egress topology (no --add-host
 *   pseudo-filter), docker's DEFAULT seccomp (no bogus override), detach
 *   sessions, task-workspace mount.
 * - DockerBackend: availability probe, acquire/exec/destroy lifecycle via a
 *   fake docker binary; the host workspace survives recycling (AT-14).
 * - ControlledProxy forward mode: whitelisted host relayed, others refused.
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  buildDockerRunArgs,
  DockerBackend,
  ControlledProxy,
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

describe("R3 task 3.1 — hardened docker args v2", () => {
  it("internal network egress, default seccomp, detach, workspace mount", () => {
    const args = buildDockerRunArgs({
      image: "forgegent-sandbox:1",
      name: "sbx-x",
      workspaceHostDir: "/data/runner/work/t1",
      limits: { memoryMb: 512, cpus: 1, egressHosts: [], timeoutMs: 1000 },
      env: { FORGEGENT_SANDBOX_TOKEN: "tok" },
      network: "forgegent-internal",
      detach: true,
      command: ["sleep", "infinity"],
    });
    expect(args).toContain("--detach");
    expect(args[args.indexOf("--network") + 1]).toBe("forgegent-internal");
    expect(args.join(" ")).not.toContain("--add-host");
    // docker's DEFAULT seccomp profile applies; no bogus override value.
    expect(args.join(" ")).not.toContain("seccomp=");
    expect(args).toContain("/data/runner/work/t1:/workspace:rw");
    expect(args[args.indexOf("-e") + 1]).toBe("FORGEGENT_SANDBOX_TOKEN=tok");
    // Hardening unchanged (AT-16).
    expect(args[args.indexOf("--user") + 1]).toBe("65534:65534");
    expect(args[args.indexOf("--cap-drop") + 1]).toBe("ALL");
    expect(args).toContain("no-new-privileges");
    expect(args).toContain("--read-only");
  });
});

describe("R3 task 3.1 — DockerBackend lifecycle (fake docker binary)", () => {
  function fakeDocker(logPath: string): string {
    const dir = mktmp("fakebin-");
    const script = join(dir, "docker");
    writeFileSync(
      script,
      [
        "#!/bin/sh",
        `echo "$@" >> ${JSON.stringify(logPath)}`,
        'case "$1" in',
        '  version) echo "24.0.7";;',
        '  exec) echo "hello-from-sandbox";;',
        "esac",
        "exit 0",
      ].join("\n"),
    );
    chmodSync(script, 0o755);
    tmpRoots.push(dir);
    return script;
  }

  it("acquire → exec → destroy with the right invocations; workspace persists", async () => {
    const logDir = mktmp("dockerlog-");
    const logPath = join(logDir, "calls.log");
    const workspace = mktmp("sbx-ws-");
    writeFileSync(join(workspace, "script.py"), "print('hi')");
    const backend = new DockerBackend({
      image: "forgegent-sandbox:1",
      network: "forgegent-internal",
      binary: fakeDocker(logPath),
      rootDir: mktmp("sbx-root-"),
    });
    expect(await backend.available()).toBe(true);

    const handle = await backend.acquireSession("sess-r3", {
      workspaceHostDir: workspace,
      env: { FORGEGENT_SANDBOX_TOKEN: "tok-1" },
    });
    expect(handle.workspaceDir).toBe(workspace);
    const run = await backend.runInSession(handle, ["/bin/sh", "-c", "python script.py"]);
    expect(run.stdout).toContain("hello-from-sandbox");
    await backend.destroySession(handle);

    const log = readFileSync(logPath, "utf-8");
    const acquireLine = log.split("\n").find((l) => l.startsWith("run --detach"));
    expect(acquireLine).toContain("--network forgegent-internal");
    expect(acquireLine).toContain(`${workspace}:/workspace:rw`);
    expect(acquireLine).toContain("FORGEGENT_SANDBOX_TOKEN=tok-1");
    expect(log).toContain("exec -w /workspace forgegent-sbx-sess-r3 /bin/sh -c python script.py");
    expect(log.split("\n").some((l) => l.startsWith("rm -f forgegent-sbx-sess-r3"))).toBe(true);
    // AT-14: the host workspace survives recycling.
    expect(existsSync(join(workspace, "script.py"))).toBe(true);
  });

  it("availability probe reports false when the daemon is unreachable", async () => {
    const backend = new DockerBackend({
      image: "x",
      binary: "/nonexistent/docker-binary",
      rootDir: mktmp("sbx-root2-"),
    });
    expect(await backend.available()).toBe(false);
  });
});

describe("R3 task 3.2 — proxy forward mode (per-token egress whitelist)", () => {
  it("relays whitelisted hosts and refuses everything else", async () => {
    const port = 39000 + Math.floor(Math.random() * 1000);
    const proxy = new ControlledProxy({ port, host: "127.0.0.1" });
    await proxy.start();
    const token = proxy.issueToken(["api.ok.local"]);
    try {
      const blocked = await fetch(`http://127.0.0.1:${port}/forward`, {
        method: "POST",
        headers: { "x-forgegent-token": token, "content-type": "application/json" },
        body: JSON.stringify({ url: "http://evil.local/exfil", method: "GET" }),
      });
      expect(blocked.status).toBe(403);
      expect(await blocked.json()).toMatchObject({ error: expect.stringContaining("evil.local") });

      // Whitelisted but unreachable upstream → 502 (allowed, failed to
      // connect) — proving the whitelist check passed.
      const allowed = await fetch(`http://127.0.0.1:${port}/forward`, {
        method: "POST",
        headers: { "x-forgegent-token": token, "content-type": "application/json" },
        body: JSON.stringify({ url: "http://api.ok.local/data", method: "GET" }),
      });
      expect(allowed.status).toBe(502);

      const noToken = await fetch(`http://127.0.0.1:${port}/forward`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "http://api.ok.local/data" }),
      });
      expect(noToken.status).toBe(401);
    } finally {
      await proxy.stop();
    }
  });
});
