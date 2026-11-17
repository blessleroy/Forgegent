/**
 * Production agent session factory (F1): real pi SDK loop against an
 * admin-configured OpenAI-compatible endpoint, with platform-governed
 * custom tools (Tool Gateway wrapping) and event streaming back to the
 * runner.
 *
 * Endpoint wiring uses pi's official models.json provider format with
 * ${ENV} key interpolation — the API key stays in the runner environment
 * and never enters the workspace files.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  defineTool,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export interface ProductionToolSpec {
  name: string;
  description: string;
  /** Extra TypeBox parameter fields (prompt/key are always present). */
  parameters?: Record<string, ReturnType<typeof Type.String>>;
  /** Full parameter object schema — takes precedence over `parameters`
   *  (used e.g. for declarative http tools with a JSON Schema, 2.9). */
  parametersSchema?: ReturnType<typeof Type.Object>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

/** Re-export so platform packages can build tool schemas without a direct
 *  typebox dependency edge. */
export { Type } from "typebox";

/** Convert a declarative JSON-Schema object (`{type:"object", properties}`)
 *  into a TypeBox object schema for defineTool (remediation 2.9). */
export function jsonSchemaToTypeObject(
  schema: { type?: string; properties?: Record<string, unknown> },
): ReturnType<typeof Type.Object> {
  const props: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema.properties ?? {})) {
    props[key] = Type.Unsafe(value as Parameters<typeof Type.Unsafe>[0]);
  }
  return Type.Object(props as never) as ReturnType<typeof Type.Object>;
}

export interface ProductionSessionOptions {
  cwd: string;
  userPrompt: string;
  endpoint: { baseUrl: string; model: string; apiKeyEnv: string; providerId?: string };
  systemPrompt?: string;
  tools: ProductionToolSpec[];
  /** Tool names the model may call (gateway-approved allowlist). */
  toolAllowlist: string[];
  /**
   * Release-pinned skills (remediation 2.6): markdown files already written
   * to disk by the runner; injected via skillsOverride so NOTHING outside
   * the approved list ever reaches the model (AT-09).
   */
  skillFiles?: { name: string; filePath: string; baseDir: string }[];
  /**
   * Remediation 2.12 (D35): per-task session directory + resume. When the
   * session file for `resumeSessionId` exists under `sessionDir`, it is
   * opened via SessionManager (native resume — history rehydrated, official
   * context carrier per docs/sdk.md); otherwise a fresh session starts.
   */
  sessionDir?: string;
  resumeSessionId?: string | null;
  /** Best-effort abort (task 1.2): dispose the session and reject the run. */
  signal?: AbortSignal;
  onEvent?: (event: { type: string; text?: string }) => void;
}

export const PROVIDER_ID = "forgegent";

export async function runProductionAgent(
  options: ProductionSessionOptions,
): Promise<{ text: string; sessionId: string | null }> {
  const providerId = options.endpoint.providerId ?? PROVIDER_ID;
  mkdirSync(options.cwd, { recursive: true });
  const modelsPath = join(options.cwd, ".pi-models.json");
  writeFileSync(
    modelsPath,
    JSON.stringify({
      providers: {
        [providerId]: {
          baseUrl: options.endpoint.baseUrl,
          api: "openai-completions",
          apiKey: `\${${options.endpoint.apiKeyEnv}}`,
          models: [{ id: options.endpoint.model }],
        },
      },
    }),
  );

  const runtime = await ModelRuntime.create({ modelsPath });
  const model = runtime.getModel(providerId, options.endpoint.model);
  if (!model) {
    throw new Error(
      `model ${providerId}/${options.endpoint.model} not resolvable — check endpoint config`,
    );
  }

  const loader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: join(options.cwd, ".pi-agent"),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
    // Remediation 2.6: the release-pinned skills replace any discovery —
    // the override result is the ONLY source of skills for the session.
    ...(options.skillFiles?.length
      ? {
          skillsOverride: () => ({
            skills: options.skillFiles!.map((file) => ({
              name: file.name,
              description: file.name,
              filePath: file.filePath,
              baseDir: file.baseDir,
              sourceInfo: {
                path: file.filePath,
                source: "forgegent-registry",
                scope: "project" as const,
                origin: "top-level" as const,
                baseDir: file.baseDir,
              },
              disableModelInvocation: false,
            })),
            diagnostics: [],
          }),
        }
      : {}),
  });
  await loader.reload();

  const customTools = options.tools.map((tool) =>
    defineTool({
      name: tool.name,
      label: tool.name,
      description: tool.description,
      parameters:
        tool.parametersSchema ??
        Type.Object(tool.parameters ?? { prompt: Type.String(), key: Type.String() }),
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const text = await tool.execute(params as Record<string, unknown>);
        return { content: [{ type: "text", text }], details: undefined };
      },
    }),
  );

  // Session manager: native resume when the session file exists (2.12),
  // otherwise a fresh session in the (per-task) session directory.
  let sessionManager = SessionManager.create(options.cwd, options.sessionDir);
  if (options.resumeSessionId) {
    try {
      const existing = SessionManager.findById(
        options.cwd,
        options.resumeSessionId,
        options.sessionDir,
      );
      if (existing) {
        sessionManager = SessionManager.open(existing, options.sessionDir);
      }
    } catch {
      /* resume target unreadable — fall back to a fresh session */
    }
  }

  const { session } = await createAgentSession({
    cwd: options.cwd,
    resourceLoader: loader,
    sessionManager,
    settingsManager: SettingsManager.inMemory(),
    modelRuntime: runtime,
    model,
    tools: options.toolAllowlist,
    customTools,
  });

  try {
    const unsubscribe = session.subscribe((event) => {
      const type = event.type;
      if (type === "message_update" && "assistantMessageEvent" in event) {
        const delta = event.assistantMessageEvent as { type?: string; delta?: string };
        if (delta?.type === "text_delta" && delta.delta) {
          options.onEvent?.({ type: "text_delta", text: delta.delta });
        }
      } else if (
        type === "message_start" || type === "turn_end" || type === "agent_end"
      ) {
        options.onEvent?.({ type });
      }
    });
    // Best-effort abort (task 1.2): the signal rejects the race and the
    // finally-block disposes the session, tearing down the in-flight run.
    const abortPromise = options.signal
      ? new Promise<never>((_, reject) => {
          options.signal!.addEventListener(
            "abort",
            () => reject(new Error("run aborted (cancel/timeout signal)")),
            { once: true },
          );
        })
      : null;
    try {
      await (abortPromise
        ? Promise.race([session.prompt(options.userPrompt), abortPromise])
        : session.prompt(options.userPrompt));
    } catch (error) {
      unsubscribe();
      throw error;
    }
    unsubscribe();
    return {
      text: session.getLastAssistantText() ?? "",
      sessionId: session.sessionId ?? null,
    };
  } finally {
    session.dispose();
  }
}
