#!/usr/bin/env node
/**
 * R4.7: real-deployment performance measurement (N10 endpoint set) against
 * a RUNNING compose deployment. Writes P50/P95 (ms) to stdout as JSON — the
 * baseline file records the collection environment explicitly. LLM waits
 * are excluded by measuring only the API endpoints below.
 *
 * Env: SMOKE_BASE_URL (default http://localhost:3000),
 *      SMOKE_EMPLOYEE_EMAIL / SMOKE_EMPLOYEE_PASSWORD.
 */
const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.SMOKE_EMPLOYEE_EMAIL ?? "employee@forgegent.local";
const PASSWORD = process.env.SMOKE_EMPLOYEE_PASSWORD ?? "demo-employee-123";
const ROUNDS = Number(process.env.PERF_ROUNDS ?? 40);

const signIn = await fetch(`${BASE}/api/auth/sign-in/email`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: BASE },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (!signIn.ok) {
  console.error(`[perf] sign-in failed: HTTP ${signIn.status}`);
  process.exit(1);
}
const cookies = signIn.headers.getSetCookie?.() ?? [signIn.headers.get("set-cookie") ?? ""];
const cookie = (cookies.find((c) => c.includes("session_token")) ?? "").split(";")[0];
const agentsRes = await fetch(`${BASE}/api/agents`, { headers: { cookie } });
const { agents } = await agentsRes.json();
const agent = agents?.[0];
if (!agent) {
  console.error("[perf] no agents visible — seed demo first");
  process.exit(1);
}
const createRes = await fetch(`${BASE}/api/tasks`, {
  method: "POST",
  headers: { cookie, "content-type": "application/json", origin: BASE },
  body: JSON.stringify({ agentId: agent.id, inputSummary: "perf: 不执行, 仅测量" }),
});
const createBody = await createRes.json();
const task = createBody.task ?? createBody;

const endpoints = [
  ["GET /api/agents", () => fetch(`${BASE}/api/agents`, { headers: { cookie } })],
  ["GET /api/tasks", () => fetch(`${BASE}/api/tasks`, { headers: { cookie } })],
  ["GET /api/files", () => fetch(`${BASE}/api/files`, { headers: { cookie } })],
  [
    "GET /api/tasks/:id/events (SSE 首连)",
    async () => {
      const controller = new AbortController();
      const req = fetch(`${BASE}/api/tasks/${task.id}/events`, {
        headers: { cookie },
        signal: controller.signal,
      });
      const res = await req;
      controller.abort();
      return res;
    },
  ],
];

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  return { p50: at(50), p95: at(95), min: sorted[0], max: sorted[sorted.length - 1], n: samples.length };
}

const report = { measuredAt: new Date().toISOString(), baseUrl: BASE, rounds: ROUNDS, endpoints: {} };
for (const [name, fn] of endpoints) {
  const samples = [];
  for (let i = 0; i < ROUNDS; i += 1) {
    const t0 = performance.now();
    const res = await fn();
    // consume/close the body so the measurement covers the full exchange
    await res.arrayBuffer().catch(() => undefined);
    samples.push(Math.round((performance.now() - t0) * 10) / 10);
  }
  report.endpoints[name] = stats(samples);
}
console.log(JSON.stringify(report, null, 2));
