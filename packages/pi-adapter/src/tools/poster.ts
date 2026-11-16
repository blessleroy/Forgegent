/**
 * Poster image tool (task 4.5, D16/D26): calls an admin-configured
 * OpenAI-compatible images endpoint through an injected fetch (testable),
 * validates the result, and enforces per-task idempotency — a repeated call
 * with the same key returns the cached outcome instead of re-billing.
 */
export interface ImageToolConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  size?: string;
}

export interface ImageResult {
  ok: boolean;
  /** base64 payload or a server-verified URL reference. */
  b64?: string;
  mimeType?: string;
  error?: string;
}

export interface PosterTool {
  name: string;
  description: string;
  execute(args: Record<string, unknown>): Promise<string>;
}

interface ImagesResponse {
  data?: { b64_json?: string; url?: string; revised_prompt?: string }[];
  error?: { message?: string };
}

function normalizeBase(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(`invalid base URL: ${raw}`);
  }
  return trimmed;
}

/**
 * Result validation (spec): image payloads must be non-trivial and
 * MIME-classifiable before they can become task artifacts.
 */
export function validateImagePayload(b64: string): { ok: true; mime: string } | { ok: false; error: string } {
  if (b64.length < 1024) {
    return { ok: false, error: "image payload suspiciously small" };
  }
  const head = b64.slice(0, 8);
  if (head.startsWith("/9j/")) return { ok: true, mime: "image/jpeg" };
  if (head.startsWith("iVBOR")) return { ok: true, mime: "image/png" };
  if (head.startsWith("R0lGOD")) return { ok: true, mime: "image/gif" };
  return { ok: false, error: "unrecognized image format" };
}

export function createPosterTool(
  config: ImageToolConfig,
  fetchImpl: typeof fetch = fetch,
): PosterTool & {
    takeArtifact(key: string): { b64: string; mimeType: string } | null;
    drainArtifacts(): { b64: string; mimeType: string }[];
  } {
  const cache = new Map<string, ImageResult>();
  const base = normalizeBase(config.baseUrl);

  /** Retrieve one generated payload by idempotency key. */
  function takeArtifact(key: string): { b64: string; mimeType: string } | null {
    const hit = cache.get(key);
    if (!hit?.ok) return null;
    cache.delete(key);
    return { b64: hit.b64!, mimeType: hit.mimeType! };
  }

  /** Drain every successful payload produced this run (F1 write-back). */
  function drainArtifacts(): { b64: string; mimeType: string }[] {
    const out: { b64: string; mimeType: string }[] = [];
    for (const [key, hit] of [...cache.entries()]) {
      if (hit.ok) {
        out.push({ b64: hit.b64!, mimeType: hit.mimeType! });
        cache.delete(key);
      }
    }
    return out;
  }

  async function generateOnce(prompt: string): Promise<ImageResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const res = await fetchImpl(`${base}/images/generations`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          prompt,
          size: config.size ?? "1024x1024",
          response_format: "b64_json",
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          ok: false,
          error: `images endpoint HTTP ${res.status}: ${text.slice(0, 200)}`,
        };
      }
      const body = (await res.json().catch(() => null)) as ImagesResponse | null;
      const item = body?.data?.[0];
      if (!item?.b64_json) {
        return {
          ok: false,
          error: body?.error?.message ?? "no image data in response",
        };
      }
      const validated = validateImagePayload(item.b64_json);
      if (!validated.ok) return { ok: false, error: validated.error };
      return { ok: true, b64: item.b64_json, mimeType: validated.mime };
    } catch (error) {
      return {
        ok: false,
        error: `images request failed: ${(error as Error).message}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    name: "image.generate",
    description:
      "Generate a poster image from a text prompt using the platform-configured image model. Params: {prompt: string, key: string} — key is the per-task idempotency key.",
    takeArtifact,
    drainArtifacts,
    async execute(args) {
      const prompt = String(args.prompt ?? "").trim();
      const key = String(args.key ?? "");
      if (!prompt || !key) {
        return "error: prompt and key are required";
      }
      // Idempotency (FR-06.8): same key never bills twice.
      const cached = cache.get(key);
      if (cached) {
        return cached.ok
          ? `cached:${key}: image already generated (${cached.mimeType})`
          : `cached-failure:${key}: ${cached.error}`;
      }
      const result = await generateOnce(prompt);
      cache.set(key, result);
      if (!result.ok) return `error: ${result.error}`;
      return `generated:${key}:${result.mimeType}:${result.b64!.length} bytes (b64 stored)`;
    },
  };
}
