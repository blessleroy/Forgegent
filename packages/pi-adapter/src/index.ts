/**
 * Pi SDK adapter (design.md D2/D10).
 *
 * Thin, typed boundary over `@earendil-works/pi-coding-agent` so the rest of
 * the platform never imports the SDK directly. The exact SDK version is
 * pinned in package.json (no caret) because the package has changed npm
 * scopes historically; upgrades must go through this adapter.
 */
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  defineTool,
} from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import type { ExecutionMode } from "@forgegent/shared";

export {
  createAgentSession,
  defineTool,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
};

/** Model runtime instance type (constructor is private; use create()). */
export type PlatformModelRuntime = Awaited<ReturnType<typeof ModelRuntime.create>>;

export {
  createPosterTool,
  validateImagePayload,
} from "./tools/poster.js";
export type {
  PosterTool,
  ImageToolConfig,
  ImageResult,
} from "./tools/poster.js";

export interface PlatformTool {
  /** Tool name exposed to the model (e.g. "poster.generate"). */
  name: string;
  /** JSON-schema-ish description of parameters. */
  description: string;
  /** Execute with Tool Gateway checks upstream; returns tool result text. */
  execute: (args: Record<string, unknown>) => Promise<string>;
}

export interface PlatformSessionOptions {
  /** Working directory for the task workspace. */
  cwd: string;
  /** Execution mode decides the wiring (sandboxed arrives in M3). */
  mode: ExecutionMode;
  /** Allowlisted platform tool names passed to the SDK `tools` option. */
  toolAllowlist?: string[];
  /** Platform-governed tools wired through the Tool Gateway (M1+). */
  customTools?: PlatformTool[];
  /** Model runtime; when omitted a workspace-local one is created. */
  modelRuntime?: PlatformModelRuntime;
  /** Optional system prompt override. */
  systemPrompt?: string;
}

/**
 * Create a platform-governed agent session (task 2.2).
 *
 * restricted: in-process session with a strict tool allowlist — built-in
 * coding tools are opt-in only, platform tools are injected via customTools.
 * sandboxed: deferred to the M3 execution backend (task 7.x).
 */
export async function createPlatformSession(options: PlatformSessionOptions) {
  if (options.mode === "sandboxed") {
    throw new Error(
      "createPlatformSession: sandboxed mode arrives with the M3 execution backend (tasks 7.1+)",
    );
  }
  const loader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: join(options.cwd, ".pi-agent"),
    // Platform governance: nothing is discovered from the environment in
    // restricted mode — skills/extensions arrive via overrides in M2/M3.
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
  });
  await loader.reload();

  const modelRuntime =
    options.modelRuntime ??
    (await ModelRuntime.create({
      authPath: join(options.cwd, ".pi-auth.json"),
      modelsPath: join(options.cwd, ".pi-models.json"),
    }));

  const { session } = await createAgentSession({
    cwd: options.cwd,
    resourceLoader: loader,
    sessionManager: SessionManager.create(options.cwd),
    settingsManager: SettingsManager.inMemory(),
    modelRuntime,
    ...(options.toolAllowlist ? { tools: options.toolAllowlist } : {}),
  });
  return session;
}

/**
 * Normalize an OpenAI-compatible base URL (task 2.3, D11): strip trailing
 * slashes; keep the caller's /v1 (or equivalent) path segment untouched.
 */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(`invalid base URL: ${raw}`);
  }
  return trimmed;
}

export interface ProbeResult {
  ok: boolean;
  status?: number;
  modelCount?: number;
  error?: string;
}

/**
 * Probe an OpenAI-compatible endpoint (resource-governance spec: config
 * saving must validate connectivity and auth with a clear error).
 */
export async function probeOpenAiCompatibleEndpoint(
  rawBaseUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<ProbeResult> {
  let base: string;
  try {
    base = normalizeBaseUrl(rawBaseUrl);
  } catch (error) {
    return { ok: false, error: String((error as Error).message) };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${base}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error:
          res.status === 401 || res.status === 403
            ? "authentication failed — check the API key"
            : `endpoint returned HTTP ${res.status}`,
      };
    }
    const body = (await res.json().catch(() => null)) as {
      data?: { id?: string }[];
    } | null;
    return {
      ok: true,
      status: res.status,
      modelCount: Array.isArray(body?.data) ? body.data.length : undefined,
    };
  } catch (error) {
    const message =
      (error as Error).name === "AbortError"
        ? `endpoint unreachable after ${timeoutMs}ms`
        : `endpoint unreachable: ${(error as Error).message}`;
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}
