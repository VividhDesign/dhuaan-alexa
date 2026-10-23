import { App, applyDocumentTheme } from "@modelcontextprotocol/ext-apps";
import "./styles.css";

type Level = "none" | "light" | "moderate" | "heavy";
type Lang = "en" | "hi";
type I18n = { en?: string; hi?: string };
interface Point { t: number; index: number; level?: Level }
interface Span { start: number; end: number; max_index?: number; peak_index?: number; level?: Level }
interface Card {
  kind: string;
  language: Lang;
  place?: { id?: string; name?: I18n; lat?: number; lon?: number };
  now?: number;
  run?: { generated_at?: number; last_pass_utc?: number; fires_24h?: number; stale?: boolean };
  level_24h?: Level | null;
  light_from?: number | null; arrival?: number | null; clears?: number | null;
  peak?: { t: number; index: number; level?: Level } | null;
  series?: Point[];
  sources?: { label: string; state?: string; pct: number }[]; sources_scope?: "place" | "region";
  window?: { activity?: string; duration_h?: number; best?: Span | null; alternatives?: Span[]; avoid?: Span[]; verdict?: string; close_by?: number | null } | null;
  fires?: { fires_24h?: number; by_state?: Record<string, number>; clusters?: number; top?: { label: string; district?: string; state?: string; n_fires?: number; frp_mw?: number; impact_people_hours?: number }[] } | null;
  summary?: I18n; message?: I18n; disclaimer?: I18n;
  levels?: { light: number; moderate: number; heavy: number };
}

// Dhuaan level palette (dhoop/frontend/src/lib/i18n.tsx LEVEL_COLOR)
const LEVEL_COLOR: Record<Level, string> = { none: "#22C55E", light: "#A3A3A3", moderate: "#8B5CF6", heavy: "#6D28D9" };

const T = {
  en: {
    level: { none: "No smoke", light: "Light smoke", moderate: "Moderate smoke", heavy: "Heavy smoke" } as Record<Level, string>,
    arrives: "Arrives", peaks: "Peaks", clears: "Clears", lightFrom: "Light from",
    noSmoke: "No smoke expected for 36 h", next36: "Next 36 hours · Smoke Index",
    now: "now", sources: "Smoke from", regionWide: "region-wide", fires24: "fires in 24 h",
    footer: (n: string, t: string) => `NASA VIIRS: ${n} fires in 24 h · updated ${t} IST · Index is relative, not AQI`,
    best: "Best", avoid: "Avoid", today: "today", tomorrow: "tomorrow",
    activity: { walk: "walk", run: "run", kids_play: "time for kids to play", outdoor_event: "time for the event", ventilate: "time to open windows", school_morning: "school morning" } as Record<string, string>,
    verdict: { good: "Clean air", caution: "Some smoke", indoors: "Stay indoors" } as Record<string, string>,
    noWindow: "No clean window in the next 36 h",
    firesTitle: "Farm fires, last 24 h", topClusters: "Top clusters by people exposed", peopleHours: "people-hours",
    loading: (p: string) => (p ? `Checking smoke for ${p}…` : "Checking the smoke forecast…"),
    stale: "Data may be out of date",
  },
  hi: {
    level: { none: "धुआँ नहीं", light: "हल्का धुआँ", moderate: "मध्यम धुआँ", heavy: "घना धुआँ" } as Record<Level, string>,
    arrives: "आएगा", peaks: "सबसे ज़्यादा", clears: "छँटेगा", lightFrom: "हल्का",
    noSmoke: "अगले 36 घंटे धुआँ नहीं", next36: "अगले 36 घंटे · स्मोक इंडेक्स",
    now: "अभी", sources: "धुआँ कहाँ से", regionWide: "पूरे क्षेत्र में", fires24: "आग, 24 घंटे में",
    footer: (n: string, t: string) => `NASA VIIRS: 24 घंटे में ${n} आग · अपडेट ${t} IST · इंडेक्स तुलनात्मक है, AQI नहीं`,
    best: "सबसे अच्छा", avoid: "बचें", today: "आज", tomorrow: "कल",
    activity: { walk: "सैर", run: "दौड़", kids_play: "बच्चों के खेलने का समय", outdoor_event: "कार्यक्रम का समय", ventilate: "खिड़कियाँ खोलने का समय", school_morning: "स्कूल की सुबह" } as Record<string, string>,
    verdict: { good: "साफ़ हवा", caution: "थोड़ा धुआँ", indoors: "घर के अंदर रहें" } as Record<string, string>,
    noWindow: "अगले 36 घंटे में कोई साफ़ समय नहीं",
    firesTitle: "खेतों की आग, पिछले 24 घंटे", topClusters: "सबसे ज़्यादा असर वाले समूह", peopleHours: "व्यक्ति-घंटे",
    loading: (p: string) => (p ? `${p} के लिए धुआँ देख रहे हैं…` : "धुएँ का पूर्वानुमान देख रहे हैं…"),
    stale: "डेटा पुराना हो सकता है",
  },
};

const STATE_HI: Record<string, string> = {
  Punjab: "पंजाब", "Pakistan Punjab": "पाकिस्तानी पंजाब", Haryana: "हरियाणा", Rajasthan: "राजस्थान",
  "Uttar Pradesh": "उत्तर प्रदेश", Uttarakhand: "उत्तराखंड", "Himachal Pradesh": "हिमाचल प्रदेश", Delhi: "दिल्ली",
};

const IST = "Asia/Kolkata";
const fmtTime = new Intl.DateTimeFormat("en-US", { timeZone: IST, hour: "numeric", minute: "2-digit", hour12: true });
const fmtHour = new Intl.DateTimeFormat("en-US", { timeZone: IST, hour: "numeric", hour12: true });
const fmtDay = new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" });
const time = (s: number) => fmtTime.format(s * 1000); // "3:30 AM"
const hourLabel = (s: number) => fmtHour.format(s * 1000).replace(" ", " "); // "6 PM"
const istHour = (s: number) => ((s + 19800) % 86400) / 3600;
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const levelOf = (i: number, L = { light: 15, moderate: 35, heavy: 60 }): Level =>
  i >= L.heavy ? "heavy" : i >= L.moderate ? "moderate" : i >= L.light ? "light" : "none";

function dayWord(t: number, now: number, lang: Lang): string {
  const d = (s: number) => fmtDay.format(s * 1000);
  if (d(t) === d(now)) return T[lang].today;
  if (d(t) === d(now + 86400)) return T[lang].tomorrow;
  return new Intl.DateTimeFormat("en-US", { timeZone: IST, weekday: "short" }).format(t * 1000);
}

function pill(level: Level, lang: Lang, big = true): string {
  return `<span class="pill ${big ? "pill-big" : ""}" data-level="${level}" style="--lc:${LEVEL_COLOR[level]}">
    <span class="dot" aria-hidden="true"></span>${esc(T[lang].level[level])}</span>`;
}

function header(c: Card, lang: Lang, right: string): string {
  const en = c.place?.name?.en ?? "";
  const hi = c.place?.name?.hi ?? "";
  const main = lang === "hi" && hi ? hi : en;
  const sub = lang === "hi" ? en : hi;
  return `<header class="head">
    <div class="place"><h1 class="headline" ${lang === "hi" ? 'lang="hi"' : ""}>${esc(main)}</h1>
      ${sub ? `<p class="sub" ${lang === "hi" ? "" : 'lang="hi"'}>${esc(sub)}</p>` : ""}</div>
    <div class="head-right">${right}</div></header>`;
}

function footer(c: Card, lang: Lang): string {
  const n = (c.run?.fires_24h ?? c.fires?.fires_24h ?? 0).toLocaleString("en-IN");
  const t = c.run?.generated_at ? time(c.run.generated_at) : "—";
  return `<footer class="foot">${c.run?.stale ? `<strong>${esc(T[lang].stale)} · </strong>` : ""}${esc(T[lang].footer(n, t))}</footer>`;
}

function sourcesBar(c: Card, lang: Lang): string {
  const s = (c.sources ?? []).slice(0, 3);
  if (!s.length) return "";
  const parts = s.map((x) => `<span class="src"><b>${esc(x.label)}</b> ${x.pct}%</span>`).join('<span class="sep">·</span>');
  const scope = c.sources_scope === "region" ? ` <span class="muted">(${esc(T[lang].regionWide)})</span>` : "";
  const bar = s.map((x, i) => `<span style="flex:${x.pct}" class="seg seg${i}"></span>`).join("");
  return `<section class="sources"><div class="label">${esc(T[lang].sources)}: ${parts}${scope}</div>
    <div class="srcbar" aria-hidden="true">${bar}<span style="flex:${Math.max(0, 100 - s.reduce((a, x) => a + x.pct, 0))}" class="seg rest"></span></div></section>`;
}

/** 36-hour bar timeline. Positions are fractions of [start, start + n hours]. */
function timeline(c: Card, lang: Lang, win?: Card["window"]): string {
  const series = (c.series ?? []).slice(0, 36);
  if (!series.length) return "";
  const t0 = series[0].t;
  const t1 = series[series.length - 1].t + 3600;
  const span = t1 - t0;
  const pos = (t: number) => Math.min(100, Math.max(0, ((t - t0) / span) * 100));
  const maxIdx = Math.max(60, ...series.map((p) => p.index));

  // night shading 18:00–06:00 IST, hour labels every 6 h
  let night = "", labels = "";
  const firstBoundary = t0 - ((t0 + 19800) % 21600); // last 6-hour IST boundary at/below t0
  for (let b = firstBoundary - 43200; b < t1; b += 21600) {
    if (b >= t0) labels += `<span class="hl" style="left:${pos(b)}%">${esc(hourLabel(b))}</span>`;
    if (Math.round(istHour(b)) === 18 && b + 43200 > t0) {
      night += `<span class="night" style="left:${pos(b)}%;width:${pos(b + 43200) - pos(b)}%"></span>`;
    }
  }

  const bars = series.map((p) => {
    const lv = p.level ?? levelOf(p.index, c.levels);
    const h = Math.max(3, (p.index / maxIdx) * 100);
    return `<span class="bar" style="height:${h}%;background:${LEVEL_COLOR[lv]}" title="${esc(time(p.t))}: ${p.index} (${lv})"></span>`;
  }).join("");

  const now = c.now ?? t0;
  const nowTick = now >= t0 && now <= t1
    ? `<span class="now" style="left:${pos(now)}%"><span class="now-l">${esc(T[lang].now)}</span></span>` : "";

  let overlays = "";
  if (win) {
    for (const a of win.avoid ?? []) {
      overlays += `<span class="avoid" style="left:${pos(a.start)}%;width:${pos(a.end) - pos(a.start)}%"><span class="ov-l">${esc(T[lang].avoid)}</span></span>`;
    }
    if (win.best) {
      overlays += `<span class="best" style="left:${pos(win.best.start)}%;width:${pos(win.best.end) - pos(win.best.start)}%"><span class="ov-l">${esc(T[lang].best)}</span></span>`;
    }
  }
  // threshold guides (light 15, moderate 35)
  const L = c.levels ?? { light: 15, moderate: 35, heavy: 60 };
  const guides = [L.light, L.moderate].map((v) => `<span class="guide" style="bottom:${(v / maxIdx) * 100}%"></span>`).join("");

  return `<section class="tl" aria-label="${esc(T[lang].next36)}">
    <div class="tl-title label">${esc(T[lang].next36)}</div>
    <div class="plot">${night}${guides}<div class="bars">${bars}</div>${overlays}${nowTick}</div>
    <div class="hours" aria-hidden="true">${labels}</div>
  </section>`;
}

function legend(lang: Lang): string {
  return `<div class="legend" aria-hidden="true">${(["none", "light", "moderate", "heavy"] as Level[])
    .map((l) => `<span><i style="background:${LEVEL_COLOR[l]}"></i>${esc(T[lang].level[l])}</span>`).join("")}</div>`;
}

function renderForecast(c: Card, lang: Lang): string {
  const t = T[lang];
  const lvl = (c.level_24h ?? "none") as Level;
  let line: string;
  if (c.arrival || c.peak?.index && c.peak.index >= 35) {
    const parts: string[] = [];
    if (c.arrival) parts.push(`${t.arrives} <b>${time(c.arrival)}</b>`);
    if (c.peak) parts.push(`${t.peaks} <b>${time(c.peak.t)}</b>`);
    if (c.clears) parts.push(`${t.clears} <b>${time(c.clears)}</b>`);
    line = parts.join(' <span class="sep">·</span> ');
  } else if (c.light_from) {
    line = `${t.lightFrom} <b>${time(c.light_from)}</b>` + (c.peak ? ` <span class="sep">·</span> ${t.peaks} <b>${time(c.peak.t)}</b>` : "");
  } else {
    line = esc(t.noSmoke);
  }
  return header(c, lang, pill(lvl, lang)) +
    `<p class="line">${line}</p>` + timeline(c, lang) + legend(lang) + sourcesBar(c, lang) + footer(c, lang);
}

function renderWindow(c: Card, lang: Lang): string {
  const t = T[lang];
  const w = c.window ?? {};
  const act = t.activity[w.activity ?? "walk"] ?? w.activity ?? "";
  const now = c.now ?? 0;
  let headline: string;
  if (w.best) {
    const range = `${time(w.best.start)}–${time(w.best.end)} ${dayWord(w.best.start, now, lang)}`;
    headline = lang === "hi" ? `${act}: ${range}` : `Best ${act}: ${range}`;
  } else headline = t.noWindow;
  const verdict = w.verdict ?? "good";
  const vLevel: Level = verdict === "good" ? "none" : verdict === "caution" ? "light" : "heavy";
  const vPill = `<span class="pill pill-big" data-level="${vLevel}" style="--lc:${LEVEL_COLOR[vLevel]}"><span class="dot" aria-hidden="true"></span>${esc(t.verdict[verdict] ?? verdict)}</span>`;
  const avoid = (w.avoid ?? []).map((a) => `${time(a.start)}–${time(a.end)}`).join(", ");
  const line = `<p class="line"><b class="best-txt">${esc(headline)}</b>${avoid ? ` <span class="sep">·</span> ${esc(t.avoid)} <b>${esc(avoid)}</b>` : ""}</p>`;
  return header(c, lang, vPill) + line + timeline(c, lang, w) + legend(lang) + sourcesBar(c, lang) + footer(c, lang);
}

function peopleHours(n: number): string {
  if (n >= 1e6) return `≈${(n / 1e6).toFixed(1)} M`;
  if (n >= 1e3) return `≈${Math.round(n / 1e3)} k`;
  return `≈${n}`;
}

function renderFires(c: Card, lang: Lang): string {
  const t = T[lang];
  const f = c.fires ?? {};
  const total = f.fires_24h ?? c.run?.fires_24h ?? 0;
  const states = Object.entries(f.by_state ?? {}).sort((a, b) => b[1] - a[1]);
  const st = (s: string) => (lang === "hi" ? STATE_HI[s] ?? s : s);
  const stateRows = states.slice(0, 5).map(([s, n]) =>
    `<li><span class="sname">${esc(st(s))}</span><span class="sbar"><i style="width:${(n / (states[0]?.[1] || 1)) * 100}%"></i></span><b>${n.toLocaleString("en-IN")}</b></li>`).join("");
  const top = (f.top ?? []).slice(0, 5).map((x, i) =>
    `<li><span class="rank">${i + 1}</span><span class="cl"><b>${esc(x.district ?? x.label)}</b> <span class="muted">${esc(st(x.state ?? ""))} · ${x.n_fires ?? 0} ${lang === "hi" ? "आग" : x.n_fires === 1 ? "fire" : "fires"}</span></span><b class="ph">${peopleHours(x.impact_people_hours ?? 0)} <span class="muted">${esc(t.peopleHours)}</span></b></li>`).join("");
  return `<header class="head"><div class="place"><h1 class="headline">${esc(t.firesTitle)}</h1>
      <p class="sub">${esc(c.place?.name?.[lang] ?? c.place?.name?.en ?? "")}</p></div>
    <div class="head-right"><div class="bignum">${total.toLocaleString("en-IN")}</div><div class="label">${esc(t.fires24)}</div></div></header>
    <div class="fires-grid">
      <section><ul class="states">${stateRows}</ul></section>
      <section><div class="label">${esc(t.topClusters)}</div><ol class="top">${top}</ol></section>
    </div>` + footer(c, lang);
}

function renderMessage(c: Card, lang: Lang): string {
  const m = c.message?.[lang] ?? c.message?.en ?? c.summary?.[lang] ?? "";
  return `<div class="msg"><p class="headline" ${lang === "hi" ? 'lang="hi"' : ""}>${esc(m)}</p>
    <p class="label muted">${esc(c.disclaimer?.[lang] ?? "")}</p></div>`;
}

const root = () => document.getElementById("card")!;

export function render(sc: unknown): void {
  const c = sc as Card | undefined;
  if (!c || typeof c !== "object" || !c.kind) return;
  const lang: Lang = c.language === "hi" ? "hi" : "en";
  document.documentElement.lang = lang;
  const el = root();
  el.dataset.kind = c.kind;
  el.innerHTML =
    c.kind === "forecast" ? renderForecast(c, lang)
    : c.kind === "window" ? renderWindow(c, lang)
    : c.kind === "fires" ? renderFires(c, lang)
    : c.kind === "compare" && c.series ? renderForecast(c, lang)
    : renderMessage(c, lang);
}

function skeleton(place: string, lang: Lang = "en"): void {
  const el = root();
  el.dataset.kind = "loading";
  el.innerHTML = `<header class="head"><div class="place"><h1 class="headline">${esc(place || "Dhuaan")}</h1>
    <p class="sub">${esc(T[lang].loading(place))}</p></div><div class="head-right"><span class="pill pill-big skel">&nbsp;</span></div></header>
    <section class="tl"><div class="plot skel-plot"></div></section>`;
}

(window as unknown as { __render: typeof render }).__render = render;

// Connect only when embedded by a host (the preview harness runs top-level).
if (window.parent !== window) {
  const app = new App({ name: "Dhuaan card", version: "1.0.0" });
  app.ontoolinput = (params) => {
    const a = (params.arguments ?? {}) as Record<string, unknown>;
    const lang: Lang = a.language === "hi" ? "hi" : "en";
    skeleton(String(a.place ?? a.query ?? a.location ?? ""), lang);
  };
  app.ontoolresult = (result) => render(result.structuredContent);
  app.onhostcontextchanged = (ctx) => {
    if (ctx.theme) applyDocumentTheme(ctx.theme);
  };
  app.connect().then(() => {
    const theme = app.getHostContext()?.theme;
    applyDocumentTheme(theme ?? "dark");
  }).catch((err) => console.error("Dhuaan card: connect failed", err));
}
