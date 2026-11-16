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
  execute: (args: Record<string, unknown>) => Promise<string>;
}

export interface ProductionSessionOptions {
  cwd: string;
  userPrompt: string;
  endpoint: { baseUrl: string; model: string; apiKeyEnv: string; providerId?: string };
  systemPrompt?: string;
  tools: ProductionToolSpec[];
  /** Tool names the model may call (gateway-approved allowlist). */
  toolAllowlist: string[];
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
  });
  await loader.reload();

  const customTools = options.tools.map((tool) =>
    defineTool({
      name: tool.name,
      label: tool.name,
      description: tool.description,
      parameters: Type.Object(
        tool.parameters ?? { prompt: Type.String(), key: Type.String() },
      ),
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const text = await tool.execute(params as Record<string, unknown>);
        return { content: [{ type: "text", text }], details: undefined };
      },
    }),
  );

  const { session } = await createAgentSession({
    cwd: options.cwd,
    resourceLoader: loader,
    sessionManager: SessionManager.create(options.cwd),
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
    await session.prompt(options.userPrompt);
    unsubscribe();
    return {
      text: session.getLastAssistantText() ?? "",
      sessionId: session.sessionId ?? null,
    };
  } finally {
    session.dispose();
  }
}
