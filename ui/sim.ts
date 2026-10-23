/// <reference types="vite/client" />
// Dhuaan · Alexa+ experience simulator (unofficial).
// Talks to the local agent backend (same origin) and renders the MCP App card the way a real
// MCP Apps host does: card HTML from resources/read -> sandboxed iframe -> ext-apps AppBridge.
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import logoSvg from "../addon/assets/logo.svg?raw";
import "./sim.css";

type Lang = "en" | "hi";
interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  ms?: number;
  result?: { text?: string; structuredContent?: Record<string, unknown> | null; isError?: boolean };
}
interface AskResponse { reply: { text: string; language: Lang }; tool_calls: ToolCall[]; ms_total?: number; model?: string }
interface Info { model?: string; agent?: string; mcp_url?: string; protocolVersion?: string; serverInfo?: { name?: string; title?: string; version?: string }; tools?: string[] }

const REPLAY_DATE = "2025-10-31";
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const isHindi = (s: string) => /[ऀ-ॿ]/.test(s);
const fmtMs = (ms?: number) => (ms == null ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`);

const params = new URLSearchParams(location.search);
let sessionId = newSessionId();
let replay = params.get("replay") === "1";
let busy = false;
let info: Info = {};
let cardHtml: Promise<string> | null = null;
let current: { bridge: AppBridge; iframe: HTMLIFrameElement } | null = null;
let audio: HTMLAudioElement | null = null;

function newSessionId(): string {
  try { return crypto.randomUUID(); } catch { return `s-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, body === undefined ? {} : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json() as Promise<T>;
}

/* ---------- header ---------- */
async function loadInfo() {
  try {
    info = await api<Info>("/api/info");
    if (info.protocolVersion) $("chip-mcp").textContent = `MCP ${info.protocolVersion} · Streamable HTTP`;
    $("chip-mcp").title = [
      info.serverInfo ? `Server: ${info.serverInfo.title ?? info.serverInfo.name} ${info.serverInfo.version ?? ""}` : "",
      info.mcp_url ? `Endpoint: ${info.mcp_url}` : "",
      info.tools?.length ? `Tools: ${info.tools.join(", ")}` : "",
    ].filter(Boolean).join("\n");
    const agent = (info.agent ?? "Strands Agents").replace(/\s*Agents?$/i, "");
    $("chip-agent").textContent = `Agent: ${agent} + ${info.model ?? "?"}`;
  } catch (e) {
    $("chip-agent").textContent = "Agent: offline";
    console.warn(e);
  }
}

function setReplay(on: boolean) {
  replay = on;
  $<HTMLInputElement>("replay").checked = on;
  $("banner").hidden = !on;
  document.body.classList.toggle("replaying", on);
  tickClock();
}

/* ---------- idle screen clock (IST) ---------- */
function tickClock() {
  const t = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });
  const d = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" });
  if (replay) {
    $("idle-time").textContent = "8:30 PM";
    $("idle-date").textContent = "Friday, 31 October 2025 · replay · IST";
  } else {
    $("idle-time").textContent = t.format(new Date());
    $("idle-date").textContent = `${d.format(new Date())} · IST`;
  }
}

/* ---------- MCP Apps host: AppBridge + sandboxed iframe ---------- */
function getCardHtml(): Promise<string> {
  cardHtml ??= api<{ uri: string; mimeType: string; html: string }>("/api/card").then((r) => r.html);
  cardHtml.catch(() => { cardHtml = null; });
  return cardHtml;
}

async function showCard(call: ToolCall, lang: Lang) {
  const html = await getCardHtml();
  const screen = $("screen");
  if (current) {
    try { await current.bridge.close(); } catch { /* already closed */ }
    current.iframe.remove();
    current = null;
  }
  $("idle").hidden = true;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts"); // opaque origin: no cookies, no storage, no same-origin access
  iframe.title = "Dhuaan forecast card (MCP App)";
  iframe.className = "card-frame";
  screen.appendChild(iframe);

  const bridge = new AppBridge(
    null, // no MCP client: the card makes no server calls, so nothing is proxied
    { name: "Dhuaan Alexa+ simulator", version: "1.0.0" },
    { logging: {} },
    {
      hostContext: {
        theme: "dark",
        displayMode: "inline",
        availableDisplayModes: ["inline"],
        platform: "web",
        locale: lang === "hi" ? "hi-IN" : "en-IN",
        timeZone: "Asia/Kolkata",
        containerDimensions: { width: Math.round(iframe.clientWidth), height: Math.round(iframe.clientHeight) },
        deviceCapabilities: { touch: true, hover: false },
      },
    },
  );
  bridge.onloggingmessage = (p) => console.log("[card]", p.level, p.data);
  bridge.onsizechange = () => { /* fixed-size display: ignore */ };
  bridge.oninitialized = () => {
    const app = bridge.getAppVersion();
    $("host-note").innerHTML = `Card: MCP App <code>ui://dhuaan/forecast-card.html</code> · ${esc(app?.name ?? "view")} ${esc(app?.version ?? "")} connected via ext-apps <code>AppBridge</code> in a sandboxed iframe`;
    void bridge.sendToolInput({ arguments: call.input ?? {} });
    void bridge.sendToolResult({
      content: [{ type: "text", text: call.result?.text ?? "" }],
      structuredContent: call.result?.structuredContent ?? undefined,
      isError: call.result?.isError ?? false,
    });
  };
  // Listen before the view loads, so its ui/initialize request is never missed.
  await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
  iframe.srcdoc = html;
  current = { bridge, iframe };
}

/* ---------- conversation ---------- */
function bubble(cls: string, html: string): HTMLElement {
  const el = document.createElement("div");
  el.className = `msg ${cls}`;
  el.innerHTML = html;
  $("log").appendChild(el);
  el.scrollIntoView({ block: "end" });
  return el;
}

function addUser(text: string) {
  bubble("user", `<p ${isHindi(text) ? 'lang="hi"' : ""}>${esc(text)}</p>`);
}

function detailHtml(r: AskResponse): string {
  const calls = r.tool_calls ?? [];
  const rows = calls.length
    ? calls.map((c) => `
      <div class="call">
        <div class="kv"><span>Tool</span><code>${esc(c.name)}</code>${c.result?.isError ? '<span class="err-tag">isError</span>' : ""}</div>
        <div class="kv"><span>Tool time</span><b>${fmtMs(c.ms)}</b></div>
        <div class="kv col"><span>Arguments</span><pre>${esc(JSON.stringify(c.input ?? {}, null, 2))}</pre></div>
        ${c.result?.structuredContent ? `<details class="sc"><summary>structuredContent <span class="muted">(kind: ${esc((c.result.structuredContent as { kind?: string }).kind ?? "?")})</span></summary><pre>${esc(JSON.stringify(c.result.structuredContent, null, 2))}</pre></details>` : ""}
      </div>`).join("")
    : `<div class="kv"><span>Tool</span><span class="muted">none (the assistant answered directly)</span></div>`;
  return `<details class="detail"><summary>Response detail</summary>
    ${rows}
    <div class="kv"><span>Total</span><b>${fmtMs(r.ms_total)}</b><span class="muted">· ${esc(r.model ?? info.model ?? "")}</span></div>
  </details>`;
}

function addAssistant(r: AskResponse) {
  const lang = r.reply?.language ?? (isHindi(r.reply?.text ?? "") ? "hi" : "en");
  const tools = (r.tool_calls ?? []).map((c) => c.name);
  const meta = `<div class="meta">${tools.length ? `called <code>${esc(tools.join(", "))}</code> · ` : ""}${fmtMs(r.ms_total)}</div>`;
  const el = bubble("assistant", `<p ${lang === "hi" ? 'lang="hi"' : ""}>${esc(r.reply?.text ?? "")}</p>${meta}${detailHtml(r)}`);
  if (params.get("detail") === "1") el.querySelector("details.detail")?.setAttribute("open", ""); // for demo screenshots
}

function setBusy(on: boolean) {
  busy = on;
  $<HTMLButtonElement>("send").disabled = on;
  $<HTMLInputElement>("text").disabled = on;
  document.body.classList.toggle("busy", on);
}

function setCaption(text: string, lang: Lang, speaking = false) {
  $("caption").innerHTML = `${speaking ? '<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>' : ""}<span ${lang === "hi" ? 'lang="hi"' : ""}>${esc(text)}</span>`;
}

async function speak(text: string, lang: Lang) {
  if (!text) return;
  try {
    const t = await api<{ audio_b64: string; mimeType?: string; voice?: string; engine?: string }>("/api/tts", { text, language: lang });
    if (t.voice) $("chip-voice").textContent = `Voice: Amazon Polly (${t.voice}${t.engine ? `, ${t.engine}` : ""})`;
    audio?.pause();
    audio = new Audio(`data:${t.mimeType ?? "audio/mpeg"};base64,${t.audio_b64}`);
    audio.onplay = () => { setCaption(text, lang, true); $("device").classList.add("speaking"); };
    audio.onended = audio.onpause = () => { setCaption(text, lang, false); $("device").classList.remove("speaking"); };
    await audio.play().catch(() => {
      // Autoplay blocked: offer a play button in the caption.
      const b = document.createElement("button");
      b.className = "ghost play"; b.type = "button"; b.textContent = "▶ Play reply";
      b.onclick = () => { void audio?.play(); b.remove(); };
      $("caption").appendChild(b);
    });
  } catch (e) {
    console.warn("TTS failed", e);
  }
}

async function ask(text: string) {
  text = text.trim();
  if (!text || busy) return;
  addUser(text);
  $<HTMLInputElement>("text").value = "";
  $<HTMLSelectElement>("mic-lang").value = isHindi(text) ? "hi-IN" : "en-IN"; // follow the user's language
  const thinking = bubble("assistant thinking", `<p>thinking<span class="dots"><i>.</i><i>.</i><i>.</i></span></p>`);
  setBusy(true);
  setCaption("…", "en");
  const started = performance.now();
  try {
    const r = await api<AskResponse>("/api/ask", { session_id: sessionId, text, replay_date: replay ? REPLAY_DATE : null });
    r.ms_total ??= performance.now() - started;
    thinking.remove();
    addAssistant(r);
    const lang: Lang = r.reply?.language ?? (isHindi(r.reply?.text ?? "") ? "hi" : "en");
    setCaption(r.reply?.text ?? "", lang);
    const withCard = [...(r.tool_calls ?? [])].reverse().find((c) => c.result?.structuredContent);
    if (withCard) showCard(withCard, lang).catch((e) => console.error("card host failed", e));
    void speak(r.reply?.text ?? "", lang);
  } catch (e) {
    thinking.remove();
    bubble("assistant error", `<p>Sorry, something went wrong.</p><pre>${esc(e instanceof Error ? e.message : e)}</pre>`);
    setCaption("Sorry, something went wrong.", "en");
  } finally {
    setBusy(false);
    $<HTMLInputElement>("text").focus();
  }
}

async function resetSession() {
  try { await api("/api/reset", { session_id: sessionId }); } catch (e) { console.warn(e); }
  sessionId = newSessionId();
  $("log").innerHTML = "";
  audio?.pause();
  if (current) { try { await current.bridge.close(); } catch { /* ignore */ } current.iframe.remove(); current = null; }
  $("idle").hidden = false;
  $("caption").innerHTML = '<span class="muted">Ask a question on the right, or tap the mic.</span>';
}

/* ---------- optional speech input ---------- */
function setupMic() {
  const SR = (window as unknown as { webkitSpeechRecognition?: new () => any; SpeechRecognition?: new () => any })
    .webkitSpeechRecognition ?? (window as unknown as { SpeechRecognition?: new () => any }).SpeechRecognition;
  if (!SR) return;
  $("mic-wrap").hidden = false;
  const btn = $<HTMLButtonElement>("mic");
  let rec: any = null;
  btn.onclick = () => {
    if (rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = $<HTMLSelectElement>("mic-lang").value;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    btn.classList.add("listening");
    rec.onresult = (ev: any) => {
      const res = ev.results[ev.results.length - 1];
      $<HTMLInputElement>("text").value = res[0].transcript;
      if (res.isFinal) void ask(res[0].transcript);
    };
    rec.onerror = (ev: any) => console.warn("speech error", ev.error);
    rec.onend = () => { btn.classList.remove("listening"); rec = null; };
    rec.start();
  };
}

/* ---------- boot ---------- */
$("logo").innerHTML = logoSvg;
$<HTMLFormElement>("form").addEventListener("submit", (e) => { e.preventDefault(); void ask($<HTMLInputElement>("text").value); });
$<HTMLInputElement>("replay").addEventListener("change", (e) => setReplay((e.target as HTMLInputElement).checked));
$("reset").addEventListener("click", () => void resetSession());
setReplay(replay);
setInterval(tickClock, 15_000);
setupMic();
void loadInfo();
void getCardHtml().catch((e) => console.warn("card resource not available yet", e));
if (params.get("ask")) void ask(params.get("ask")!);
