// HTTP routes as a Web-standard fetch handler (used by both Lambda and the local server).
import { createMcpHandler, isLegacyRequest, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { getLatest } from "./data.js";
import { PRIVACY_HTML, TERMS_HTML } from "./generated/assets.js";
import { createServer, REPO, VERSION, type ToolLogger } from "./mcp.js";

const ALLOWED_ORIGINS = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
const json = (obj: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...headers } });

const HOME = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dhuaan for Alexa+</title><style>body{font:18px/1.5 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;background:#11151c;color:#e8eaed}a{color:#a78bfa}code{background:#1f2630;padding:.1em .3em;border-radius:4px}</style>
<h1>Dhuaan for Alexa+</h1><p>A self-hosted MCP server (Streamable HTTP, protocol 2025-11-25) that forecasts farm-fire smoke for north India over the next 36 hours, in English and Hindi.</p>
<p>MCP endpoint: <code>POST /mcp</code>. Source, docs and how to try it: <a href="${REPO}">${REPO}</a></p>
<p><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p></html>`;

export function createApp(log?: ToolLogger) {
  const mcp = createMcpHandler(() => createServer(log), { responseMode: "json" });
  // 2025-era clients (Alexa+, protocol 2025-11-25): stateless, one server + transport per POST, plain JSON responses.
  const legacy = async (req: Request): Promise<Response> => {
    const server = createServer(log);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
      const res = await transport.handleRequest(req);
      return new Response(await res.arrayBuffer(), { status: res.status, headers: res.headers });
    } finally {
      await server.close();
    }
  };
  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path === "/mcp") {
      const origin = req.headers.get("origin");
      if (origin && !ALLOWED_ORIGINS.test(origin)) return json({ error: "origin not allowed" }, 403);
      if (req.method !== "POST")
        return json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }, 405, { allow: "POST" });
      if (await isLegacyRequest(req)) return legacy(req);
      return mcp.fetch(req); // 2026-07-28 clients

    }
    if (req.method !== "GET" && req.method !== "HEAD") return json({ error: "method not allowed" }, 405);
    if (path === "/health") {
      const d = await getLatest();
      return json({ ok: true, version: VERSION, data_generated_at: d.meta.generated_at,
        age_min: Math.round((Date.now() / 1000 - d.meta.generated_at) / 60), stale: d.stale });
    }
    if (path === "/privacy") return html(PRIVACY_HTML);
    if (path === "/terms") return html(TERMS_HTML);
    if (path === "/") return html(HOME);
    return json({ error: "not found" }, 404);
  };
}
