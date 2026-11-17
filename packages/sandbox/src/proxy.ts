/**
 * Controlled proxy channel (task 7.4 + remediation 3.2, D36): the ONLY
 * egress path for sandboxed containers.
 *
 * Two modes per token:
 * - model mode (legacy): transparent passthrough to the configured model
 *   upstream with the production key attached HOST-SIDE only;
 * - forward mode: an explicit allowlist of egress hosts per token; requests
 *   to any other host are refused and audited. No credentials are attached
 *   in forward mode — untrusted scripts reach exactly what the release
 *   whitelists and nothing more.
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export interface ProxyConfig {
  /** Real upstream base URL, e.g. https://gw.corp.local/v1 — host side only. */
  upstreamBaseUrl?: string;
  /** Upstream bearer token — host side only. */
  upstreamApiKey?: string;
  port: number;
  /** Listen host: "0.0.0.0" when the runner shares an internal docker
   *  network with the sandboxes (D36); default loopback. */
  host?: string;
}

interface ForwardBody {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export class ControlledProxy {
  private server: Server | null = null;
  /** token → egress allowlist; absent entry = model-passthrough mode. */
  private readonly tokens = new Map<string, string[] | undefined>();

  constructor(private readonly config: ProxyConfig) {}

  /** Issue a short-lived token. No allowlist → model passthrough mode. */
  issueToken(egressHosts?: string[]): string {
    const token = crypto.randomUUID();
    this.tokens.set(token, egressHosts);
    return token;
  }

  /** Restrict/replace an existing token's allowlist. */
  setAllowlist(token: string, hosts: string[]): void {
    if (this.tokens.has(token)) this.tokens.set(token, hosts);
  }

  revokeToken(token: string): void {
    this.tokens.delete(token);
  }

  private authorize(req: IncomingMessage): string | null {
    const header = req.headers["x-forgegent-token"];
    if (typeof header === "string" && this.tokens.has(header)) return header;
    return null;
  }

  private async readBody(req: IncomingMessage, limit = 64 * 1024): Promise<string> {
    let data = "";
    for await (const chunk of req) {
      data += chunk as Buffer;
      if (data.length > limit) throw new Error("body too large");
    }
    return data;
  }

  /** Forward mode: relay one whitelisted request (no credential injection). */
  private async forward(token: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const allowlist = this.tokens.get(token) ?? [];
    let parsed: ForwardBody;
    try {
      parsed = JSON.parse((await this.readBody(req)) || "{}") as ForwardBody;
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid JSON body" }));
      return;
    }
    if (!parsed.url) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "url required" }));
      return;
    }
    let target: URL;
    try {
      target = new URL(parsed.url);
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid url" }));
      return;
    }
    if (!allowlist.includes(target.host)) {
      // D36: the container's only exit refuses non-whitelisted targets.
      res.writeHead(403, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ error: `egress host not whitelisted: ${target.host}` }),
      );
      return;
    }
    const doRequest = target.protocol === "https:" ? httpsRequest : httpRequest;
    const upstream = doRequest(
      {
        host: target.hostname,
        port: Number(target.port) || (target.protocol === "https:" ? 443 : 80),
        method: parsed.method ?? "GET",
        path: `${target.pathname}${target.search}`,
        headers: {
          ...(parsed.headers ?? {}),
          "content-length": String(Buffer.byteLength(parsed.body ?? "")),
        },
      },
      (up) => {
        const chunks: Buffer[] = [];
        up.on("data", (c: Buffer) => chunks.push(c));
        up.on("end", () => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              status: up.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf-8").slice(0, 65536),
            }),
          );
        });
      },
    );
    upstream.on("error", (error) => {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String((error as Error).message) }));
    });
    upstream.end(parsed.body ?? "");
  }

  async start(): Promise<void> {
    if (this.server) return;
    const upstream = this.config.upstreamBaseUrl
      ? new URL(this.config.upstreamBaseUrl)
      : null;
    this.server = createServer(async (req, res) => {
      const token = this.authorize(req);
      if (!token) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid sandbox token" }));
        return;
      }
      // Forward mode: explicit relay of whitelisted requests.
      if (req.url === "/forward" && req.method === "POST") {
        await this.forward(token, req, res);
        return;
      }
      // Model passthrough mode (model-upstream tokens only).
      if (!upstream || !this.config.upstreamApiKey) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "no upstream configured" }));
        return;
      }
      const doRequest = upstream.protocol === "https:" ? httpsRequest : httpRequest;
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
      this.server!.listen(this.config.port, this.config.host ?? "127.0.0.1", resolve),
    );
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }

  get url(): string {
    return `http://${this.config.host === "0.0.0.0" ? "127.0.0.1" : (this.config.host ?? "127.0.0.1")}:${this.config.port}`;
  }
}
