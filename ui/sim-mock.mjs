// Tiny stand-in for the Python simulator backend, for UI work and screenshots only.
// Serves dist/sim.html at / and answers the same JSON API from ui/fixtures/. Run: node sim-mock.mjs
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const fixture = (f) => JSON.parse(fs.readFileSync(path.join(dir, "fixtures", f), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });
const timeEn = (s) => fmt.format(s * 1000);
function timeHi(s) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }).format(s * 1000));
  const part = h < 4 ? "रात" : h < 12 ? "सुबह" : h < 16 ? "दोपहर" : h < 19 ? "शाम" : "रात";
  return `${part} ${timeEn(s).replace(/ [AP]M$/, "")} बजे`;
}

function replyFor(sc) {
  const hi = sc.language === "hi";
  const name = sc.place?.name?.[hi ? "hi" : "en"]?.split(",")[0] ?? "";
  if (sc.kind === "forecast") {
    if (!sc.arrival) return hi ? `${name} में अगले 36 घंटे खेतों की आग का धुआँ आने की उम्मीद नहीं है।` : `No farm-fire smoke is expected in ${name} for the next 36 hours.`;
    const heavy = sc.level_24h === "heavy";
    return hi
      ? `हाँ। ${name} में धुआँ लगभग ${timeHi(sc.arrival)} पहुँचेगा, ${timeHi(sc.peak.t)} के आसपास सबसे ज़्यादा होगा और ${timeHi(sc.clears)} तक छँट जाएगा। रात में खिड़कियाँ बंद रखें।`
      : `Yes. Farm-fire smoke reaches ${name} around ${timeEn(sc.arrival)}, ${heavy ? "turning heavy" : "at a moderate level"} and peaking near ${timeEn(sc.peak.t)}. It should clear by ${timeEn(sc.clears)}. Keep windows shut overnight.`;
  }
  if (sc.kind === "window") {
    const b = sc.window.best;
    return `The cleanest two hours for the kids to play outside in ${name} are ${timeEn(b.start)} to ${timeEn(b.end)} tomorrow. Avoid the early morning, when smoke peaks.`;
  }
  if (sc.kind === "fires") {
    const top = sc.fires.top[0];
    return `Satellites saw ${sc.fires.fires_24h.toLocaleString("en-IN")} farm fires in the last 24 hours, most of them in Pakistan Punjab and Punjab. The cluster affecting the most people is near ${top.district}.`;
  }
  return sc.message?.[hi ? "hi" : "en"] ?? "";
}

function answer(text, replayDate) {
  const hi = /[ऀ-ॿ]/.test(text) || /\b(kya|dhuan|dhuaan|hoga|aayega)\b/i.test(text);
  const language = hi ? "hi" : "en";
  let tool, sc, input;
  if (/fire|farm|aag|आग/i.test(text)) {
    tool = "get_farm_fire_activity"; input = { state: "all", top: 5, language }; sc = fixture("fires.json");
  } else if (/walk|play|kids|best time|outside|खेल|सैर|बच्च/i.test(text)) {
    tool = "find_clean_air_window"; input = { place: "Rohini", activity: "kids_play", day: "next_36h", language }; sc = fixture("window.json");
  } else if (/rohini|रोहिणी|delhi|दिल्ली/i.test(text)) {
    tool = "get_smoke_forecast"; input = { place: hi ? "रोहिणी" : "Rohini", language, ...(replayDate ? { replay_date: replayDate } : {}) };
    sc = fixture(replayDate ? "forecast-replay.json" : hi ? "forecast-hi.json" : "forecast.json");
  } else {
    return {
      reply: { text: hi ? "किस इलाक़े के लिए देखूँ? जैसे रोहिणी, गुरुग्राम या पटियाला।" : "Which area should I check? For example Rohini, Gurugram or Patiala.", language },
      tool_calls: [], ms_total: 1430, model: "gemma4:12b (Ollama)",
    };
  }
  sc.language = language;
  const t = replyFor(sc);
  return {
    reply: { text: t, language },
    tool_calls: [{ name: tool, input, ms: 184, result: { text: t, structuredContent: sc, isError: false } }],
    ms_total: 2870, model: "gemma4:12b (Ollama)",
  };
}

// 0.4 s of silence as a WAV, so the audio path is exercised without Polly.
function silentWav() {
  const rate = 8000, n = Math.round(rate * 0.4), b = Buffer.alloc(44 + n);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write("data", 36); b.writeUInt32LE(n, 40);
  b.fill(128, 44);
  return b.toString("base64");
}

const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((ok) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => ok(s ? JSON.parse(s) : {})); });

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(fs.readFileSync(path.join(dir, "dist", "sim.html")));
    }
    if (url.pathname === "/api/info") return json(res, 200, {
      model: "gemma4:12b (Ollama)", agent: "Strands Agents", mcp_url: "http://127.0.0.1:3000/mcp", protocolVersion: "2025-11-25",
      serverInfo: { name: "dhuaan", title: "Dhuaan smoke forecast", version: "1.0.0" },
      tools: ["get_smoke_forecast", "find_clean_air_window", "get_farm_fire_activity"],
    });
    if (url.pathname === "/api/card") return json(res, 200, {
      uri: "ui://dhuaan/forecast-card.html", mimeType: "text/html;profile=mcp-app",
      html: fs.readFileSync(path.join(dir, "dist", "forecast-card.html"), "utf8"),
    });
    if (req.method === "POST" && url.pathname === "/api/ask") {
      const body = await readBody(req);
      await sleep(500);
      return json(res, 200, answer(String(body.text ?? ""), body.replay_date ?? null));
    }
    if (req.method === "POST" && url.pathname === "/api/tts") return json(res, 200, { audio_b64: silentWav(), mimeType: "audio/wav", voice: "Kajal", engine: "neural" });
    if (req.method === "POST" && url.pathname === "/api/reset") return json(res, 200, { ok: true });
    json(res, 404, { error: "not found" });
  } catch (e) {
    json(res, 500, { error: String(e) });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`sim mock on http://127.0.0.1:${PORT}`));
