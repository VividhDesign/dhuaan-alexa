// Tool logic, independent of MCP wiring: each returns { text, structuredContent }.
import { getLatest, getReplay, isStale, nowFor, type Dataset } from "./data.js";
import { haversineKm, inGrid, levelOf, sampleSeries, startIndex, summarize } from "./forecast.js";
import { CLARIFY, DISCLAIMER, firesSummary, forecastSummary, outOfArea, windowSummary, type Lang } from "./i18n.js";
import { amazonLocationGeocode, resolvePlace, type Geocoder, type Place } from "./places.js";
import type { Result } from "./schema.js";
import { findWindow, type Activity, type Day } from "./window.js";

export interface ToolOutput { text: string; structured: Result; log: Record<string, unknown> }
export const deps: { geocode: Geocoder; clock: () => number } = {
  geocode: amazonLocationGeocode,
  clock: () => Math.floor(Date.now() / 1000),
};

function runInfo(d: Dataset, wall: number): NonNullable<Result["run"]> {
  return {
    generated_at: d.meta.generated_at, last_pass_utc: d.meta.last_pass_utc, fires_24h: d.meta.fires_24h,
    clusters: d.meta.clusters, wind_source: d.meta.wind_source, stale: isStale(d, wall), replay_date: d.replay_date,
  };
}

const base = (lang: Lang) => ({ language: lang, disclaimer: DISCLAIMER });

function clarify(lang: Lang, d: Dataset, wall: number): ToolOutput {
  return {
    text: CLARIFY[lang],
    structured: { kind: "clarify", ...base(lang), message: CLARIFY, run: runInfo(d, wall), now: nowFor(d, wall) },
    log: { match: null },
  };
}

interface PlaceForecast {
  place: Place; times: number[]; raw: number[]; d: Dataset; now: number; wall: number;
  sources: { label: string; state: string; pct: number }[]; scope: "place" | "region"; point: "dhuaan_place" | "grid_sample";
}

/** Resolve a place and its forecast series from the current hour onward; or a clarify / out_of_area result. */
async function placeForecast(input: string, lang: Lang, replay?: string): Promise<PlaceForecast | ToolOutput> {
  const wall = deps.clock();
  const d = replay ? await getReplay(replay) : await getLatest();
  const now = nowFor(d, wall);
  const place = await resolvePlace(input, d.places, deps.geocode);
  if (!place) return clarify(lang, d, wall);
  const k0 = startIndex(d.times, now);
  const times = d.times.slice(k0);
  let raw: number[] | null;
  let point: PlaceForecast["point"] = "grid_sample";
  const row = place.dhuaan ? d.places.find((p) => p.id === place.id) : undefined;
  if (row) { raw = row.series.slice(k0); point = "dhuaan_place"; }
  else raw = inGrid(d.grid, place.lat, place.lon) ? sampleSeries(d.grid, d.frames, place.lat, place.lon)!.slice(k0) : null;
  if (!raw) {
    const label = place.name.en.split(",")[0];
    const msg = outOfArea(label);
    return {
      text: msg[lang],
      structured: { kind: "out_of_area", ...base(lang), message: msg, run: runInfo(d, wall), now,
        place: { id: place.id, name: place.name, lat: place.lat, lon: place.lon, match: place.match, forecast_point: "grid_sample" } },
      log: { place_id: place.id, match: place.match },
    };
  }
  let sources = row?.sources ?? [];
  let scope: "place" | "region" = "place";
  if (!row) {
    const near = d.places.map((p) => ({ p, km: haversineKm(place.lat, place.lon, p.lat, p.lon) })).sort((a, b) => a.km - b.km)[0];
    if (near && near.km <= 40) sources = near.p.sources;
    else {
      // region-wide: the top hotspot districts by people-hours under smoke
      const seen = new Set<string>();
      sources = [];
      for (const c of [...d.hotspots.clusters].sort((a, b) => b.impact_people_hours - a.impact_people_hours)) {
        if (seen.has(c.district)) continue;
        seen.add(c.district);
        sources.push({ label: c.district, state: c.state, pct: 0 });
        if (sources.length === 3) break;
      }
      scope = "region";
    }
  }
  return { place, times, raw, d, now, wall, sources, scope, point };
}

const isOutput = (x: PlaceForecast | ToolOutput): x is ToolOutput => "structured" in x;

function forecastFields(pf: PlaceForecast, lang: Lang, role: "resident" | "school" = "resident") {
  const lv = pf.d.meta.levels;
  const s = summarize(pf.raw, pf.times, lv);
  const lvl = s.peak?.level ?? "none";
  const adv = pf.d.advice[role]?.[s.level_24h] ?? pf.d.advice.resident?.[s.level_24h];
  return {
    s,
    fields: {
      place: { id: pf.place.id, name: pf.place.name, lat: pf.place.lat, lon: pf.place.lon, match: pf.place.match, forecast_point: pf.point },
      now: pf.now,
      run: runInfo(pf.d, pf.wall),
      level_24h: s.level_24h, light_from: s.light_from, arrival: s.arrival, clears: s.clears, peak: s.peak,
      series: s.series.map((v, k) => ({ t: pf.times[k], index: v, level: levelOf(v, lv) })),
      sources: pf.sources, sources_scope: pf.scope,
      advice: adv ? { en: adv.en, hi: adv.hi } : undefined,
      levels: lv,
    },
    spokenAdvice: (lvl === "moderate" || lvl === "heavy") && adv ? { en: adv.en[0], hi: adv.hi[0] } : null,
  };
}

export async function getSmokeForecast(a: { place: string; language?: Lang; replay_date?: string }): Promise<ToolOutput> {
  const lang = a.language ?? "en";
  const pf = await placeForecast(a.place, lang, a.replay_date);
  if (isOutput(pf)) return pf;
  const { s, fields, spokenAdvice } = forecastFields(pf, lang);
  const stale_from = fields.run.stale ? pf.d.meta.generated_at : null;
  const facts = { name: pf.place.name, level_24h: s.level_24h, arrival: s.arrival, clears: s.clears, peak: s.peak,
    light_from: s.light_from, sources: pf.sources, sources_scope: pf.scope, advice: spokenAdvice, stale_from };
  const summary = { en: forecastSummary(facts, pf.now, "en"), hi: forecastSummary(facts, pf.now, "hi") };
  return {
    text: summary[lang],
    structured: { kind: "forecast", ...base(lang), ...fields, summary },
    log: { place_id: pf.place.id, match: pf.place.match, level: s.level_24h, stale: fields.run.stale },
  };
}

export async function findCleanAirWindow(a: {
  place: string; activity?: Activity; duration_hours?: number; day?: Day; language?: Lang; replay_date?: string;
}): Promise<ToolOutput> {
  const lang = a.language ?? "en";
  const activity = a.activity ?? "walk";
  const pf = await placeForecast(a.place, lang, a.replay_date);
  if (isOutput(pf)) return pf;
  const { fields } = forecastFields(pf, lang, activity === "school_morning" ? "school" : "resident");
  const w = findWindow({ series: fields.series.map((p) => p.index), times: pf.times, now: pf.now, activity,
    duration: a.duration_hours, day: a.day ?? "next_36h", levels: pf.d.meta.levels });
  const summary = { en: windowSummary(w, pf.place.name, pf.now, "en"), hi: windowSummary(w, pf.place.name, pf.now, "hi") };
  return {
    text: summary[lang],
    structured: { kind: "window", ...base(lang), ...fields, window: w, summary },
    log: { place_id: pf.place.id, match: pf.place.match, level: fields.level_24h, verdict: w.verdict, stale: fields.run.stale },
  };
}

export async function getFarmFireActivity(a: { state?: string; top?: number; language?: Lang; replay_date?: string }): Promise<ToolOutput> {
  const lang = a.language ?? "en";
  const state = a.state ?? "all";
  const wall = deps.clock();
  const d = a.replay_date ? await getReplay(a.replay_date) : await getLatest();
  const h = d.hotspots;
  const top = [...h.clusters]
    .filter((c) => state === "all" || c.state === state)
    .sort((x, y) => y.impact_people_hours - x.impact_people_hours)
    .slice(0, a.top ?? 5)
    .map(({ label, district, state, n_fires, frp_mw, impact_people_hours }) => ({ label, district, state, n_fires, frp_mw, impact_people_hours }));
  const n = state === "all" ? h.totals.fires_24h : h.totals.by_state[state] ?? 0;
  const facts = { n, by_state: h.totals.by_state, state, top };
  const summary = { en: firesSummary(facts, "en"), hi: firesSummary(facts, "hi") };
  return {
    text: summary[lang],
    structured: {
      kind: "fires", ...base(lang), now: nowFor(d, wall), run: runInfo(d, wall), summary,
      fires: { fires_24h: h.totals.fires_24h, by_state: h.totals.by_state, clusters: d.meta.clusters,
        last_pass_utc: d.meta.last_pass_utc, top25_share_delhi_pct: h.top25_share_delhi_pct ?? null, state, top },
    },
    log: { state, stale: isStale(d, wall) },
  };
}
