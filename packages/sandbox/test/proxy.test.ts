import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { ControlledProxy } from "../src/proxy.js";

let upstream: ReturnType<typeof createServer>;
let upstreamHits: { auth: string | undefined; path: string }[] = [];

beforeAll(async () => {
  upstream = createServer((req, res) => {
    upstreamHits.push({
      auth: req.headers.authorization,
      path: req.url ?? "",
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, models: [] }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
});

afterAll(async () => {
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

describe("controlled proxy (task 7.4)", () => {
  it("forwards authorized sandbox calls with the host-side key", async () => {
    const port = (upstream.address() as { port: number }).port;
    const proxy = new ControlledProxy({
      upstreamBaseUrl: `http://127.0.0.1:${port}/v1`,
      upstreamApiKey: "sk-host-side-secret",
      port: 0,
    });
    // port 0 → random; but our impl listens on config.port — pick a fixed one.
    const proxyPort = 18_790;
    proxy["config"].port = proxyPort;
    await proxy.start();
    const token = proxy.issueToken();

    const res = await fetch(`http://127.0.0.1:${proxyPort}/models`, {
      headers: { "x-forgegent-token": token },
    });
    expect(res.status).toBe(200);
    // The upstream saw the production key — the sandbox never sees it.
    expect(upstreamHits.at(-1)?.auth).toBe("Bearer sk-host-side-secret");
    await proxy.stop();
  });

  it("rejects calls without a valid token", async () => {
    const port = (upstream.address() as { port: number }).port;
    const proxy = new ControlledProxy({
      upstreamBaseUrl: `http://127.0.0.1:${port}/v1`,
      upstreamApiKey: "sk-x",
      port: 18_791,
    });
    await proxy.start();
    const res = await fetch("http://127.0.0.1:18791/models");
    expect(res.status).toBe(401);
    // Revoked tokens stop working.
    const token = proxy.issueToken();
    proxy.revokeToken(token);
    const res2 = await fetch("http://127.0.0.1:18791/models", {
      headers: { "x-forgegent-token": token },
    });
    expect(res2.status).toBe(401);
    await proxy.stop();
  });
});
