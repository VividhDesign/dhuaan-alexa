import { createServer as http } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { ResultSchema } from "../src/schema.js";
import { deps } from "../src/tools.js";
import { seed } from "./helpers.js";

let base = "";
let srv: ReturnType<typeof http>;
const d = seed();
deps.clock = () => d.meta.generated_at; // 31 Oct 2025, 20:30 IST
deps.geocode = async (q) => (/mumbai/i.test(q) ? { label: "Mumbai, Maharashtra, India", lat: 19.07, lon: 72.88 } : null);

beforeAll(async () => {
  const app = createApp(() => {});
  srv = http(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    const r = await app(new Request(`http://localhost${req.url}`, { method: req.method, headers, body: req.method === "POST" ? Buffer.concat(chunks) : undefined }));
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((ok) => srv.listen(0, ok));
  base = `http://localhost:${(srv.address() as AddressInfo).port}`;
});
afterAll(() => { srv.close(); });

const H = { "content-type": "application/json", accept: "application/json, text/event-stream" };
async function rpc(method: string, params?: unknown, extra: Record<string, string> = {}) {
  const r = await fetch(`${base}/mcp`, { method: "POST", headers: { ...H, ...extra }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return { status: r.status, body: await r.json() };
}
const call = async (name: string, args: unknown) => (await rpc("tools/call", { name, arguments: args })).body.result;

describe("MCP protocol (2025-11-25, stateless JSON)", () => {
  it("initialize", async () => {
    const { body } = await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    expect(body.result.protocolVersion).toBe("2025-11-25");
    expect(body.result.serverInfo.icons.length).toBeGreaterThan(0);
    expect(body.result.instructions).toMatch(/not AQI/);
  });
  it("tools/list", async () => {
    const { tools } = (await rpc("tools/list")).body.result;
    expect(tools.length).toBeGreaterThanOrEqual(3);
    for (const t of tools) {
      expect(t.outputSchema).toBeTruthy(); expect(t.annotations.readOnlyHint).toBe(true);
      expect(t._meta.ui.resourceUri).toBe("ui://dhuaan/forecast-card.html");
    }
  });
  it("resources/read card", async () => {
    const r = (await rpc("resources/read", { uri: "ui://dhuaan/forecast-card.html" })).body.result;
    expect(r.contents[0].mimeType).toBe("text/html;profile=mcp-app"); expect(r.contents[0].text).toContain("<html");
  });
  it("get_smoke_forecast Rohini (replay night)", async () => {
    const r = await call("get_smoke_forecast", { place: "Rohini" });
    expect(r.structuredContent.kind).toBe("forecast"); expect(ResultSchema.safeParse(r.structuredContent).success).toBe(true);
    expect(r.content[0].text).toMatch(/^Yes\. Moderate smoke .* tonight around 3:30 AM/); expect(r.content[0].text).not.toMatch(/AQI/);
  });
  it("Hindi", async () => {
    const r = await call("get_smoke_forecast", { place: "रोहिणी", language: "hi" });
    expect(r.content[0].text).toContain("आज रात लगभग 3:30 बजे");
  });
  it("window, fires validate", async () => {
    for (const [n, a, k] of [["find_clean_air_window", { place: "Gurugram", activity: "kids_play", day: "tomorrow" }, "window"],
      ["find_clean_air_window", { place: "Dwarka", activity: "school_morning" }, "window"],
      ["get_farm_fire_activity", {}, "fires"]] as const) {
      const r = await call(n, a);
      expect(r.structuredContent.kind).toBe(k); expect(ResultSchema.safeParse(r.structuredContent).success).toBe(true);
    }
  });
  it("Mumbai -> out_of_area; xx -> clarify (not errors)", async () => {
    const m = await call("get_smoke_forecast", { place: "Mumbai" });
    expect(m.structuredContent.kind).toBe("out_of_area"); expect(m.isError).toBeFalsy();
    expect((await call("get_smoke_forecast", { place: "xx" })).structuredContent.kind).toBe("clarify");
  });
  it("GET /mcp 405, bad Origin 403, batch rejected", async () => {
    expect((await fetch(`${base}/mcp`)).status).toBe(405);
    expect((await rpc("tools/list", undefined, { origin: "https://evil.example" })).status).toBe(403);
    const b = await fetch(`${base}/mcp`, { method: "POST", headers: H, body: JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "tools/list" }]) });
    expect(b.status).toBeGreaterThanOrEqual(400);
  });
  it("handler time is small when warm", async () => {
    await call("get_smoke_forecast", { place: "Noida" });
    const t0 = performance.now();
    for (const p of ["Rohini", "Noida", "Patiala", "Pitampura", "Gurugram"]) await call("get_smoke_forecast", { place: p });
    expect((performance.now() - t0) / 5).toBeLessThan(200);
  });
});
