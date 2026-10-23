// Local dev server: node dist/local.js (PORT, default 3000).
import { createServer } from "node:http";
import { createApp } from "./app.js";

const app = createApp();
const port = Number(process.env.PORT ?? 3000);

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  const r = await app(new Request(`http://${req.headers.host ?? "localhost"}${req.url}`, {
    method: req.method, headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
  }));
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, () => console.log(`dhuaan MCP on http://localhost:${port}/mcp`));
