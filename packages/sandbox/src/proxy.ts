/**
 * Controlled proxy channel (task 7.4): the sandbox reaches models through
 * this host-side proxy with a short-lived token; production API keys never
 * enter the container filesystem or environment.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export interface ProxyConfig {
  /** Real upstream base URL, e.g. https://gw.corp.local/v1 — host side only. */
  upstreamBaseUrl: string;
  /** Upstream bearer token — host side only. */
  upstreamApiKey: string;
  port: number;
}

export class ControlledProxy {
  private server: Server | null = null;
  private readonly tokens = new Set<string>();

  constructor(private readonly config: ProxyConfig) {}

  /** Issue a short-lived token for one sandbox session. */
  issueToken(): string {
    const token = crypto.randomUUID();
    this.tokens.add(token);
    return token;
  }

  revokeToken(token: string): void {
    this.tokens.delete(token);
  }

  private authorize(req: IncomingMessage): boolean {
    const header = req.headers["x-forgegent-token"];
    return typeof header === "string" && this.tokens.has(header);
  }

  async start(): Promise<void> {
    if (this.server) return;
    const upstream = new URL(this.config.upstreamBaseUrl);
    const doRequest = upstream.protocol === "https:" ? httpsRequest : httpRequest;
    this.server = createServer((req, res) => {
      if (!this.authorize(req)) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid sandbox token" }));
        return;
      }
      const upstreamReq = doRequest(
        {
          host: upstream.hostname,
          port: Number(upstream.port) || (upstream.protocol === "https:" ? 443 : 80),
          method: req.method,
          path: `${upstream.pathname.replace(/\/+$/, "")}${req.url ?? ""}`,
          headers: {
            // The production key is attached HERE, host-side only.
            authorization: `Bearer ${this.config.upstreamApiKey}`,
            "content-type": req.headers["content-type"] ?? "application/json",
          },
        },
        (upstreamRes) => {
          res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
          upstreamRes.pipe(res);
        },
      );
      upstreamReq.on("error", (error) => {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String((error as Error).message) }));
      });
      req.pipe(upstreamReq);
    });
    await new Promise<void>((resolve) =>
      this.server!.listen(this.config.port, "127.0.0.1", resolve),
    );
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }

  get url(): string {
    return `http://127.0.0.1:${this.config.port}`;
  }
}
