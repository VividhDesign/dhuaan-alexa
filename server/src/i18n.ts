// Spoken summaries in English and Hindi. Wording follows Dhuaan's reviewed bot (engine/messages.py):
// lead with the answer, IST times with day words, no AQI, no index numbers, no emojis, no URLs.
import type { Level } from "./forecast.js";
import { istDay, istHour, type WindowResult } from "./window.js";

export type Lang = "en" | "hi";
export type Bi = { en: string; hi: string };

const LEVEL_WORD: Record<Lang, Record<Level, string>> = {
  en: { none: "no smoke", light: "light smoke", moderate: "moderate smoke", heavy: "heavy smoke" },
  hi: { none: "धुआँ नहीं", light: "हल्का धुआँ", moderate: "मध्यम धुआँ", heavy: "घना धुआँ" },
};
const WEEKDAY_EN = ["Thursday", "Friday", "Saturday", "Sunday", "Monday", "Tuesday", "Wednesday"]; // istDay 0 = 1 Jan 1970, a Thursday
const WEEKDAY_HI = ["गुरुवार", "शुक्रवार", "शनिवार", "रविवार", "सोमवार", "मंगलवार", "बुधवार"];

export function clock(t: number, lang: Lang): string {
  const h = istHour(t);
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  const h12 = hh % 12 || 12;
  const m = String(mm).padStart(2, "0");
  if (lang === "hi") return `${h12}:${m} बजे`;
  return `${h12}:${m} ${hh < 12 ? "AM" : "PM"}`;
}

/** Day phrase for an IST time relative to now: "tonight", "tomorrow morning", "आज रात", "कल सुबह". */
export function dayPart(t: number, now: number, lang: Lang): string {
  const diff = istDay(t) - istDay(now);
  const h = istHour(t), nowH = istHour(now);
  const overnight = diff === 1 && h < 5 && nowH >= 17; // 3:30 AM after an evening question = tonight
  if (lang === "hi") {
    const part = h >= 20 || h < 5 ? "रात" : h < 12 ? "सुबह" : h < 16 ? "दोपहर" : "शाम";
    if (overnight) return "आज रात";
    const day = diff === 0 ? "आज" : diff === 1 ? "कल" : diff === 2 ? "परसों" : WEEKDAY_HI[istDay(t) % 7];
    return `${day} ${part}`;
  }
  if (overnight) return "tonight";
  const part = h < 5 ? "night" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 20 ? "evening" : "night";
  if (diff === 0) return part === "night" ? "tonight" : `this ${part}`;
  if (diff === 1) return `tomorrow ${part}`;
  return `${WEEKDAY_EN[istDay(t) % 7]} ${part}`;
}

/** "tonight around 3:30 AM" / "आज रात लगभग 3:30 बजे" */
export function when(t: number, now: number, lang: Lang): string {
  return lang === "hi" ? `${dayPart(t, now, lang)} लगभग ${clock(t, lang)}` : `${dayPart(t, now, lang)} around ${clock(t, lang)}`;
}

/** Same-day range: "tomorrow afternoon, 4:30 to 5:30 PM" */
function range(a: number, b: number, now: number, lang: Lang): string {
  if (lang === "hi") return `${dayPart(a, now, lang)} ${clock(a, lang).replace(" बजे", "")} से ${clock(b, lang)} तक`;
  return `${dayPart(a, now, lang)}, ${clock(a, lang)} to ${clock(b, lang)}`;
}

export const spoken = (name: { en: string; hi: string }, lang: Lang) => name[lang].split(",")[0].trim();

function sourcesText(sources: { label: string }[], lang: Lang, scope: "place" | "region"): string {
  if (!sources.length) return "";
  const names = sources.slice(0, 2).map((s) => s.label);
  if (lang === "hi") {
    const n = names.join(" और ");
    return scope === "place" ? `यह ज़्यादातर ${n} के पास खेतों की आग से आएगा।` : `आज सबसे ज़्यादा धुआँ ${n} के पास की आग से है।`;
  }
  const n = names.join(" and ");
  return scope === "place" ? `It's mostly from fires near ${n}.` : `Today's biggest smoke sources are fires near ${n}.`;
}

export interface ForecastFacts {
  name: { en: string; hi: string }; level_24h: Level; arrival: number | null; clears: number | null;
  peak: { t: number; index: number; level: Level } | null; light_from: number | null;
  sources: { label: string }[]; sources_scope: "place" | "region"; advice: Bi | null; stale_from: number | null;
}

export function forecastSummary(f: ForecastFacts, now: number, lang: Lang): string {
  const place = spoken(f.name, lang);
  const parts: string[] = [];
  if (f.stale_from) parts.push(lang === "hi" ? `${when(f.stale_from, now, lang)} के पूर्वानुमान के अनुसार:` : `Based on the forecast from ${when(f.stale_from, now, lang)}:`);
  const lvl = f.peak?.level ?? "none";
  if (f.arrival) {
    const word = LEVEL_WORD[lang][lvl];
    if (lang === "hi") {
      parts.push(`हाँ। ${place} में खेतों की आग का ${word} ${when(f.arrival, now, lang)} पहुँच सकता है` +
        (f.peak ? `, ${when(f.peak.t, now, lang)} सबसे ज़्यादा रहेगा` : "") +
        (f.clears ? ` और ${when(f.clears, now, lang)} तक छँट जाएगा।` : "।"));
    } else {
      parts.push(`Yes. ${cap(word)} from farm fires should reach ${place} ${when(f.arrival, now, lang)}` +
        (f.peak ? `, peak ${when(f.peak.t, now, lang)}` : "") +
        (f.clears ? ` and clear by ${when(f.clears, now, lang)}.` : "."));
    }
    const src = sourcesText(f.sources, lang, f.sources_scope);
    if (src) parts.push(src);
    if (f.advice) parts.push(f.advice[lang]);
  } else if (lvl === "light" && f.peak) {
    parts.push(lang === "hi"
      ? `${place} में अगले 36 घंटे में सिर्फ़ हल्का धुआँ रहेगा, सबसे ज़्यादा ${when(f.peak.t, now, lang)}।`
      : `Only light farm-fire smoke is expected in ${place} over the next 36 hours, heaviest ${when(f.peak.t, now, lang)}.`);
    const src = sourcesText(f.sources, lang, f.sources_scope);
    if (src) parts.push(src);
  } else {
    parts.push(lang === "hi"
      ? `${place} में अगले 36 घंटे में खेतों की आग का धुआँ आने की उम्मीद नहीं है।`
      : `No farm-fire smoke is expected in ${place} in the next 36 hours.`);
  }
  return parts.join(" ");
}

const ACTIVITY: Record<string, Bi> = {
  walk: { en: "walk", hi: "सैर" }, run: { en: "run", hi: "दौड़" },
  kids_play: { en: "outdoor play for the kids", hi: "बच्चों के बाहर खेलने" },
  outdoor_event: { en: "outdoor event", hi: "बाहर के कार्यक्रम" },
};

export function windowSummary(w: WindowResult, name: { en: string; hi: string }, now: number, lang: Lang): string {
  const place = spoken(name, lang);
  const hi = lang === "hi";
  if (!w.best) return hi ? `${place} के लिए अगले 36 घंटे में कोई उपयुक्त समय नहीं मिला।` : `I couldn't find a suitable time in ${place} in the next 36 hours.`;
  const b = w.best;
  const avoid = w.avoid.find((a) => a.end > now);
  const avoidText = avoid
    ? hi ? ` ${range(avoid.start, avoid.end, now, lang)} बाहर जाने से बचें, तब ${avoid.peak_index >= 60 ? "घना" : "मध्यम"} धुआँ रहेगा।`
         : ` Avoid ${range(avoid.start, avoid.end, now, lang)}, when ${avoid.peak_index >= 60 ? "heavy" : "moderate"} smoke is expected.`
    : "";

  if (w.activity === "school_morning") {
    const day = dayPart(b.start, now, lang);
    if (w.verdict === "good") return hi ? `${place} में ${day} खेतों की आग का धुआँ नहीं दिखता, इसलिए प्रार्थना सभा और पीटी बाहर हो सकती है।`
      : `${cap(day)} looks clear of farm-fire smoke in ${place}, so assembly and PE can be outdoors.`;
    if (w.verdict === "caution") return hi ? `${place} में ${day} हल्का धुआँ रहेगा; सभा बाहर हो सकती है, पर पीटी हल्की रखें।`
      : `Light smoke is expected in ${place} ${day}; outdoor assembly is fine, but keep PE light.`;
    return hi ? `${place} में ${day} ${LEVEL_WORD.hi[b.level]} रहेगा, इसलिए प्रार्थना सभा और पीटी अंदर करें।`
      : `${cap(LEVEL_WORD.en[b.level])} is expected in ${place} ${day}, so move assembly and PE indoors.`;
  }

  if (w.activity === "ventilate") {
    const close = w.close_by
      ? hi ? ` खिड़कियाँ ${when(w.close_by, now, lang)} तक बंद कर दें।` : ` Close them by ${when(w.close_by, now, lang)}.`
      : hi ? " उसके बाद भी अगले 36 घंटे में धुआँ आने की उम्मीद नहीं है।" : " No smoke is expected after that in the next 36 hours.";
    if (w.verdict !== "good") return hi ? `${place} में अगले 36 घंटे में हवा पूरी तरह साफ़ नहीं रहेगी; सबसे कम धुआँ ${range(b.start, b.end, now, lang)} रहेगा।`
      : `The air in ${place} won't be fully clear in the next 36 hours; the least smoky time to air out is ${range(b.start, b.end, now, lang)}.`;
    return (hi ? `${place} में खिड़कियाँ खोलने का सबसे अच्छा समय ${range(b.start, b.end, now, lang)} है।`
      : `The best time to open the windows in ${place} is ${range(b.start, b.end, now, lang)}.`) + close;
  }

  const act = ACTIVITY[w.activity] ?? ACTIVITY.walk;
  const dur = w.duration_h;
  let head: string;
  if (hi) head = `${place} में ${dur} घंटे की ${act.hi} के लिए सबसे साफ़ समय ${range(b.start, b.end, now, lang)} है।`;
  else head = `The cleanest time for ${w.activity === "kids_play" ? `${dur} hours of ${act.en}` : `a ${dur}-hour ${act.en}`} in ${place} is ${range(b.start, b.end, now, lang)}.`;
  if (w.verdict === "caution") head += hi ? " तब भी हल्का धुआँ रहेगा, इसलिए हल्की गतिविधि रखें।" : " There will still be light smoke, so keep it easy.";
  if (w.verdict === "indoors") head = hi ? `${place} में पूरे दिन ${LEVEL_WORD.hi[b.level]} रहेगा, इसलिए अंदर रहना बेहतर है। सबसे कम धुआँ ${range(b.start, b.end, now, lang)} रहेगा।`
    : `Smoke stays ${b.level} all day in ${place}, so indoors is better. The least smoky time is ${range(b.start, b.end, now, lang)}.`;
  return head + (w.verdict === "indoors" ? "" : avoidText);
}

export function firesSummary(f: { n: number; by_state: Record<string, number>; state: string; top: { label: string; state: string }[] }, lang: Lang): string {
  const hi = lang === "hi";
  const st = (s: string) => (hi ? ({ Punjab: "पंजाब", Haryana: "हरियाणा", "Uttar Pradesh": "उत्तर प्रदेश", Rajasthan: "राजस्थान", "Pakistan Punjab": "पाकिस्तानी पंजाब" } as Record<string, string>)[s] ?? s : s);
  let head: string;
  if (f.state !== "all") {
    head = hi ? `पिछले 24 घंटे में सैटेलाइट ने ${st(f.state)} में ${f.n} खेतों की आग देखी।` : `Satellites saw ${f.n} farm fires in ${f.state} in the last 24 hours.`;
  } else {
    const pb = f.by_state["Punjab"] ?? 0, hr = f.by_state["Haryana"] ?? 0;
    head = hi ? `पिछले 24 घंटे में सैटेलाइट ने ${f.n} खेतों की आग देखी, जिनमें ${pb} भारतीय पंजाब और ${hr} हरियाणा में।`
      : `Satellites saw ${f.n} farm fires in the last 24 hours across the region, ${pb} in Indian Punjab and ${hr} in Haryana.`;
  }
  const t = f.top[0];
  if (!t) return head;
  if (t.state === "Pakistan Punjab") {
    const near = t.label.replace(/^near /, "");
    return head + (hi ? ` सबसे ज़्यादा लोगों तक धुआँ सीमा पार ${near} के पास, पाकिस्तान के पंजाब में, के क्लस्टर से पहुँचेगा।`
      : ` The cluster putting smoke over the most people is across the border near ${near}, in Pakistan's Punjab.`);
  }
  return head + (hi ? ` सबसे ज़्यादा लोगों तक धुआँ ${t.label.replace(/^near /, "")} (${st(t.state)}) के पास के क्लस्टर से पहुँचेगा।`
    : ` The cluster putting smoke over the most people is ${t.label}, ${t.state}.`);
}

export const CLARIFY: Bi = {
  en: "Which area or city should I check? For example, Rohini or Gurugram.",
  hi: "किस इलाक़े या शहर का पता करूँ? जैसे रोहिणी या गुरुग्राम।",
};
export const outOfArea = (place: string): Bi => ({
  en: `Dhuaan covers farm-fire smoke over Punjab, Haryana, Delhi NCR, Chandigarh and western Uttar Pradesh. ${place} is outside that area.`,
  hi: `धुआँ पंजाब, हरियाणा, दिल्ली NCR, चंडीगढ़ और पश्चिमी उत्तर प्रदेश में खेतों की आग के धुएँ का पूर्वानुमान देता है। ${place} इस क्षेत्र से बाहर है।`,
});
export const DISCLAIMER: Bi = {
  en: "Smoke Index (0–100) is relative, not AQI. Not medical advice.",
  hi: "स्मोक इंडेक्स (0–100) तुलनात्मक है, AQI नहीं। यह चिकित्सीय सलाह नहीं है।",
};

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
