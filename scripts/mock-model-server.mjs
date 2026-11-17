#!/usr/bin/env node
/**
 * Mock OpenAI-compatible endpoint for the AT-20 compose smoke test (D47).
 * Serves /v1/chat/completions, /v1/images/generations and /v1/models with
 * NO external dependencies — the smoke test exercises deployment wiring
 * (containers, seed, task loop, artifact write-back, download), not model
 * quality. The chat endpoint simulates the poster agent's tool loop: the
 * first turn calls image.generate, the second (after the tool result)
 * returns the final text.
 */
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 8901);
const fakeB64 = "iVBOR" + "A".repeat(2048); // passes validateImagePayload

const server = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf-8");
    // Debug: dump every inbound request (method, url, body head).
    console.log(`[mock-model] <- ${req.method} ${req.url} ${body.slice(0, 600)}`);
    const json = (payload, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (req.url?.includes("/models")) {
      json({ data: [{ id: "mock-chat" }, { id: "mock-image" }] });
      return;
    }
    if (req.url?.includes("/chat/completions")) {
      let messages = [];
      let stream = false;
      try {
        const parsed = JSON.parse(body);
        messages = parsed.messages ?? [];
        stream = Boolean(parsed.stream);
      } catch {
        messages = [];
      }
      const alreadyRanTool = messages.some(
        (m) => m.role === "tool" && String(m.tool_call_id ?? "").startsWith("call-img"),
      );

      const toolCall = {
        id: "call-img-1",
        type: "function",
        function: {
          name: "image.generate",
          arguments: JSON.stringify({ prompt: "smoke poster", key: "smoke-key-1" }),
        },
      };
      const finalText = "海报已生成（mock 通道），文件可在成果区下载。";

      if (!stream) {
        // Non-streaming fallback (kept for manual curl debugging).
        json({
          choices: [
            alreadyRanTool
              ? {
                  index: 0,
                  message: { role: "assistant", content: finalText },
                  finish_reason: "stop",
                }
              : {
                  index: 0,
                  message: { role: "assistant", content: null, tool_calls: [toolCall] },
                  finish_reason: "tool_calls",
                },
          ],
        });
        return;
      }

      // pi runs with stream:true — emit an OpenAI-style SSE stream.
      res.writeHead(200, { "content-type": "text/event-stream" });
      const id = "chatcmpl-mock";
      const chunk = (delta, finishReason = null) =>
        `data: ${JSON.stringify({
          id,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: "mock-chat",
          choices: [{ index: 0, delta, finish_reason: finishReason }],
        })}\n\n`;
      const send = (piece) => res.write(piece);
      if (!alreadyRanTool) {
        send(chunk({ role: "assistant", content: null }));
        send(
          chunk({
            tool_calls: [{ index: 0, ...toolCall, function: { ...toolCall.function } }],
          }),
        );
        send(chunk({}, "tool_calls"));
      } else {
        send(chunk({ role: "assistant", content: "" }));
        for (const piece of finalText.match(/.{1,24}/g) ?? []) {
          send(chunk({ content: piece }));
        }
        send(chunk({}, "stop"));
      }
      send(
        `data: ${JSON.stringify({
          id,
          object: "chat.completion.chunk",
          choices: [],
          usage: { prompt_tokens: 64, completion_tokens: 32, total_tokens: 96 },
        })}\n\n`,
      );
      res.end("data: [DONE]\n\n");
      return;
    }
    if (req.url?.includes("/images/generations")) {
      json({ data: [{ b64_json: fakeB64 }] });
      return;
    }
    json({ error: "not found" }, 404);
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[mock-model] listening on :${port} (chat + images + models)`);
});
