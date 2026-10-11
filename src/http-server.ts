import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createVpsnetServer } from "./index.js";
import { resolveApiBase } from "./api.js";
import { requireRequestAuthorization, withAuthorization, type AuthorizationContext } from "./request-context.js";

const supportedScopes = ["services:read", "services:manage", "applications:read", "applications:manage", "networking:read", "networking:manage", "functions:read", "functions:manage", "vm:exec", "vm:files"];
export interface RemoteOptions { resource: string; issuer: string; allowedOrigins?: readonly string[]; }

function publicUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("MCP public URLs must use HTTPS without credentials, query or fragment.");
  return url;
}
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

export function createRemoteServer(options: RemoteOptions) {
  requireRequestAuthorization();
  const resource = publicUrl(options.resource);
  const issuer = publicUrl(options.issuer).href.replace(/\/$/, "");
  if (resource.pathname !== "/mcp") throw new Error("The MCP resource path must be /mcp.");
  const metadataUrl = `${resource.origin}/.well-known/oauth-protected-resource/mcp`;
  const apiBase = resolveApiBase();
  const origins = new Set(options.allowedOrigins ?? []);
  for (const origin of origins) if (publicUrl(origin).origin !== origin) throw new Error("Allowed origins must be HTTPS origins.");
  const challenge = `Bearer resource_metadata="${metadataUrl}"`;

  async function authenticate(req: IncomingMessage): Promise<AuthorizationContext | null> {
    const match = /^Bearer (vpsnet_[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? "");
    if (!match) return null;
    const response = await fetch(`${apiBase}/oauth/mcp/introspect`, {
      method: "POST", headers: { Authorization: `Bearer ${match[1]}`, Accept: "application/json" },
      redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) throw new Error("VPSnet authorization is unavailable.");
    const value = await response.json() as Record<string, unknown>;
    if (value.active !== true || value.aud !== resource.href || value.iss !== issuer
        || typeof value.exp !== "number" || value.exp <= Date.now() / 1000
        || typeof value.sub !== "string" || typeof value.grant_id !== "string" || typeof value.scope !== "string"
        || !Array.isArray(value.services) || !value.services.every(x => typeof x === "string")) return null;
    return { accessToken: match[1], subject: value.sub, grantId: value.grant_id,
      expiresAt: value.exp, scopes: value.scope.split(" ").filter(x => supportedScopes.includes(x)), services: value.services };
  }

  const http = createServer(async (req, res) => {
    // TLS terminates at the supplied reverse proxy, which must preserve Host.
    if (req.headers.host !== resource.host) return json(res, 421, { error: "invalid_host" });
    if (req.headers.origin && !origins.has(req.headers.origin)) return json(res, 403, { error: "invalid_origin" });
    if (req.headers.origin) {
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Expose-Headers", "WWW-Authenticate, MCP-Protocol-Version");
    }
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, MCP-Protocol-Version, Last-Event-ID");
      res.writeHead(204); res.end(); return;
    }
    if (req.method === "GET" && ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"].includes(req.url ?? "")) {
      return json(res, 200, { resource: resource.href, authorization_servers: [issuer], scopes_supported: supportedScopes, bearer_methods_supported: ["header"], resource_name: "VPSnet AI" });
    }
    if (req.url !== "/mcp") return json(res, 404, { error: "not_found" });
    try {
      const context = await authenticate(req);
      if (!context) { res.setHeader("WWW-Authenticate", challenge); return json(res, 401, { error: "invalid_token" }); }
      if (req.method !== "POST") { res.setHeader("Allow", "POST"); return json(res, 405, { error: "method_not_allowed" }); }
      if (req.headers["mcp-session-id"]) return json(res, 400, { error: "stateless_transport" });
      if (!req.headers["content-type"]?.split(";")[0].trim().match(/^application\/json$/i)) return json(res, 415, { error: "unsupported_media_type" });
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1024 * 1024) return json(res, 413, { error: "request_too_large" });
        chunks.push(chunk);
      }
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { return json(res, 400, { error: "invalid_json" }); }
      if (Array.isArray(body)) return json(res, 400, { error: "batch_not_supported" });
      await withAuthorization(context, async () => {
        const server = createVpsnetServer({ remoteScopes: context.scopes });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.once("close", () => { void transport.close(); void server.close(); });
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
      });
    } catch {
      // Never emit upstream exceptions, tokens or request arguments into logs.
      if (!res.headersSent) json(res, 503, { error: "temporarily_unavailable" });
      else res.end();
    }
  });
  http.requestTimeout = 30_000;
  http.headersTimeout = 10_000;
  return http;
}
