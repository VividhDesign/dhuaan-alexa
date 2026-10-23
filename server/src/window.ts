// Clean-air window search: the best daylight slot for an activity, ranked by its worst hour.
import { DEFAULT_LEVELS, levelOf, type Level, type Levels } from "./forecast.js";

export type Activity = "walk" | "run" | "kids_play" | "outdoor_event" | "school_morning" | "ventilate";
export type Day = "today" | "tomorrow" | "next_36h";
export type Verdict = "good" | "caution" | "indoors";

const IST = 19800;
export const istHour = (t: number) => (((t + IST) % 86400) + 86400) % 86400 / 3600;
export const istDay = (t: number) => Math.floor((t + IST) / 86400);

const RULES: Record<Activity, { hours: number; good: number; caution: number; lastEnd: number }> = {
  walk: { hours: 1, good: 15, caution: 35, lastEnd: 20 },
  run: { hours: 1, good: 15, caution: 15, lastEnd: 20 },
  kids_play: { hours: 2, good: 15, caution: 35, lastEnd: 20 },
  outdoor_event: { hours: 3, good: 15, caution: 35, lastEnd: 20 },
  ventilate: { hours: 2, good: 15, caution: 15, lastEnd: 22 },
  school_morning: { hours: 6, good: 15, caution: 35, lastEnd: 13.5 },
};

export interface Slot { start: number; end: number; max_index: number; level: Level }
export interface WindowResult {
  activity: Activity;
  duration_h: number;
  day: Day;
  best: Slot | null;
  alternatives: Slot[];
  avoid: { start: number; end: number; peak_index: number }[];
  verdict: Verdict;
  close_by: number | null;
  widened: boolean; // requested day had no candidate slots, so we searched the next 36 h
}

interface Cand { k: number; max: number; mean: number }

/** series/times start at the current hour; all times are epoch seconds on the hour (UTC), i.e. :30 IST. */
export function findWindow(opts: {
  series: number[]; times: number[]; now: number; activity: Activity; duration?: number; day?: Day; levels?: Levels;
}): WindowResult {
  const { series, times, now, activity } = opts;
  const lv = opts.levels ?? DEFAULT_LEVELS;
  const rule = RULES[activity];
  let day: Day = opts.day ?? "next_36h";
  const d = activity === "school_morning" ? 6 : Math.max(1, Math.min(6, opts.duration ?? rule.hours));
  const today = istDay(now);

  const okDay = (t: number, dd: Day) =>
    dd === "next_36h" || istDay(t) === today + (dd === "tomorrow" ? 1 : 0);

  const candidates = (dd: Day): Cand[] => {
    const out: Cand[] = [];
    for (let k = 0; k + d <= series.length; k++) {
      const t = times[k];
      const h = istHour(t);
      if (activity === "school_morning") {
        // the next school morning: 07:30 IST on the first day whose 07:30 is still ahead (or now)
        if (Math.abs(h - 7.5) > 0.01) continue;
      } else {
        if (h < 6 || h + d > rule.lastEnd) continue;
        if (!okDay(t, dd)) continue;
      }
      const w = series.slice(k, k + d);
      out.push({ k, max: Math.max(...w), mean: w.reduce((a, b) => a + b, 0) / d });
    }
    return out;
  };

  let cands = candidates(day);
  let widened = false;
  if (!cands.length && activity !== "school_morning" && day !== "next_36h") {
    cands = candidates("next_36h");
    widened = true;
  }
  if (activity === "school_morning") cands = cands.slice(0, 1);
  const ranked = [...cands].sort((a, b) => a.max - b.max || a.mean - b.mean || a.k - b.k);

  const slot = (c: Cand): Slot => ({
    start: times[c.k], end: times[c.k] + d * 3600, max_index: Math.round(c.max), level: levelOf(c.max, lv),
  });
  const best = ranked[0] ? slot(ranked[0]) : null;
  const alternatives: Slot[] = [];
  const taken: Cand[] = ranked[0] ? [ranked[0]] : [];
  for (const c of ranked.slice(1)) {
    if (alternatives.length >= 2) break;
    if (taken.every((t) => c.k + d <= t.k || t.k + d <= c.k)) { taken.push(c); alternatives.push(slot(c)); }
  }

  // runs at or above "moderate" within the requested day (or the whole horizon)
  const avoid: WindowResult["avoid"] = [];
  let runStart: number | null = null;
  let peak = 0;
  const inScope = (k: number) => widened || day === "next_36h" || activity === "school_morning" || okDay(times[k], day);
  [...series, -1].forEach((v, k) => {
    const hit = v >= lv.moderate && inScope(k);
    if (hit && runStart === null) { runStart = k; peak = v; }
    else if (hit) peak = Math.max(peak, v);
    else if (runStart !== null) {
      avoid.push({ start: times[runStart], end: times[runStart] + (k - runStart) * 3600, peak_index: Math.round(peak) });
      runStart = null;
    }
  });

  let verdict: Verdict = "indoors";
  if (best) verdict = best.max_index < rule.good ? "good" : best.max_index < rule.caution ? "caution" : "indoors";

  let close_by: number | null = null;
  if (activity === "ventilate" && ranked[0]) {
    const k = series.findIndex((v, i) => i >= ranked[0].k && v >= lv.light);
    close_by = k === -1 ? null : times[k];
  }
  return { activity, duration_h: d, day, best, alternatives, avoid, verdict, close_by, widened };
}
