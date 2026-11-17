#!/usr/bin/env node
/**
 * AT-20 smoke driver (task 4.6): exercises the FULL closed loop against a
 * running compose deployment — employee sign-in → Hub list → task create →
 * background execution (mock model via the real pi loop) → artifact
 * download. Exits 0 only when every step passes.
 *
 * Env: SMOKE_BASE_URL (default http://localhost:3000),
 *      SMOKE_EMPLOYEE_EMAIL/PASSWORD (seed demo defaults).
 */
const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.SMOKE_EMPLOYEE_EMAIL ?? "employee@forgegent.local";
const PASSWORD = process.env.SMOKE_EMPLOYEE_PASSWORD ?? "demo-employee-123";

function fail(step, detail) {
  console.error(`[smoke] FAIL @ ${step}: ${detail}`);
  process.exit(1);
}

async function main() {
  // 1. Web is up.
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${BASE}/login`);
      if (res.ok) break;
    } catch {
      /* retry */
    }
    if (i === 59) fail("web-up", `${BASE}/login unreachable after 60 tries`);
    await new Promise((r) => setTimeout(r, 2000));
  }

  // 2. Employee signs in (better-auth).
  const signIn = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!signIn.ok) {
    fail("sign-in", `HTTP ${signIn.status}: ${(await signIn.text()).slice(0, 200)}`);
  }
  const cookies = (signIn.headers).getSetCookie?.()
    ?? [signIn.headers.get("set-cookie") ?? ""];
  const sessionCookie = cookies
    .find((c) => c.includes("session_token"))
    ?.split(";")[0];
  if (!sessionCookie) fail("sign-in", `no session cookie in: ${cookies.join(" | ").slice(0, 200)}`);
  const cookie = sessionCookie;
  const get = (path) => fetch(`${BASE}${path}`, { headers: { cookie } });

  // 3. Hub list shows the seeded poster agent (authorization-filtered).
  const agentsRes = await get("/api/agents");
  if (!agentsRes.ok) fail("hub-list", `HTTP ${agentsRes.status}`);
  const { agents } = await agentsRes.json();
  const poster = (agents ?? []).find((a) => a.slug === "poster-designer");
  if (!poster) fail("hub-list", `poster-designer missing (${(agents ?? []).length} agents)`);

  // 4. Create a task bound to the published release.
  const createRes = await fetch(`${BASE}/api/tasks`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", origin: BASE },
    body: JSON.stringify({
      agentId: poster.id,
      inputSummary: "主题: 冒烟测试\n风格: 简约",
    }),
  });
  if (!createRes.ok) fail("task-create", `HTTP ${createRes.status}: ${await createRes.text()}`);
  const createBody = await createRes.json();
  const task = createBody.task ?? createBody;
  if (!task.id) fail("task-create", `unexpected body: ${JSON.stringify(createBody).slice(0, 300)}`);
  console.log(`[smoke] task ${task.id} created`);

  // 5. Background execution to a terminal state (page closure irrelevant).
  let final;
  for (let i = 0; i < 90; i += 1) {
    const res = await get(`/api/tasks/${task.id}`);
    if (!res.ok) fail("task-poll", `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    const current = body.task ?? body;
    final = { state: current.state, outputFiles: body.outputFiles ?? [] };
    if (["completed", "failed", "cancelled", "interrupted"].includes(current.state)) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (final.state !== "completed") {
    fail("task-run", `state=${final.state} (expected completed)`);
  }
  console.log(`[smoke] task completed with ${final.outputFiles.length} artifact(s)`);

  // 6. Artifact downloads through the unified store root (review #1).
  const artifact = final.outputFiles[0];
  if (!artifact) fail("artifact", "no output files on completed task");
  const dl = await get(`/api/files/${artifact.id}/download`);
  if (!dl.ok) fail("artifact-download", `HTTP ${dl.status}`);
  const bytes = Buffer.from(await dl.arrayBuffer());
  if (bytes.byteLength < 1024) fail("artifact-download", `suspiciously small (${bytes.byteLength}B)`);

  console.log("[smoke] PASS — AT-20 closed loop green (mock model channel)");
}

main().catch((error) => fail("unexpected", String(error)));
