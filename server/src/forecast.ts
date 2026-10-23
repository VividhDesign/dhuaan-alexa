// Forecast maths ported from Dhuaan (backend/src/engine/point.py and receptors.py).

export type Level = "none" | "light" | "moderate" | "heavy";
export interface Levels { light: number; moderate: number; heavy: number }
export const DEFAULT_LEVELS: Levels = { light: 15, moderate: 35, heavy: 60 };

export interface Grid { lon0: number; lat0: number; dlon: number; dlat: number; nx: number; ny: number }

export function levelOf(index: number, lv: Levels = DEFAULT_LEVELS): Level {
  if (index >= lv.heavy) return "heavy";
  if (index >= lv.moderate) return "moderate";
  if (index >= lv.light) return "light";
  return "none";
}

export function decodeFrames(frames: string[]): Uint8Array[] {
  return frames.map((f) => new Uint8Array(Buffer.from(f, "base64")));
}

export function inGrid(g: Grid, lat: number, lon: number): boolean {
  const fx = (lon - g.lon0) / g.dlon;
  const fy = (lat - g.lat0) / g.dlat;
  return fx >= 0 && fx <= g.nx - 1 && fy >= 0 && fy <= g.ny - 1;
}

/** Bilinear sample of every frame at (lat, lon); null outside the forecast area. */
export function sampleSeries(g: Grid, frames: Uint8Array[], lat: number, lon: number): number[] | null {
  const fx = (lon - g.lon0) / g.dlon;
  const fy = (lat - g.lat0) / g.dlat;
  if (!(fx >= 0 && fx <= g.nx - 1 && fy >= 0 && fy <= g.ny - 1)) return null;
  const ix = Math.min(Math.floor(fx), g.nx - 2);
  const iy = Math.min(Math.floor(fy), g.ny - 2);
  const ax = fx - ix;
  const ay = fy - iy;
  const at = (f: Uint8Array, y: number, x: number) => f[y * g.nx + x];
  return frames.map(
    (f) =>
      (at(f, iy, ix) * (1 - ax) + at(f, iy, ix + 1) * ax) * (1 - ay) +
      (at(f, iy + 1, ix) * (1 - ax) + at(f, iy + 1, ix + 1) * ax) * ay,
  );
}

/** Index of the first frame at or after the current hour (frames are hourly). */
export function startIndex(times: number[], now: number): number {
  const k = times.findIndex((t) => t >= now - 1800);
  return k === -1 ? times.length : k;
}

export interface Summary {
  series: number[];
  level_24h: Level;
  light_from: number | null;
  arrival: number | null;
  clears: number | null;
  peak: { t: number; index: number; level: Level } | null;
}

/** Port of receptors.summarize_series, applied to future frames only. */
export function summarize(raw: number[], times: number[], lv: Levels = DEFAULT_LEVELS): Summary {
  const s = raw.map((v) => Math.max(0, Math.min(100, Math.round(v))));
  if (!s.length) return { series: [], level_24h: "none", light_from: null, arrival: null, clears: null, peak: null };
  const above = s.map((v) => v >= lv.moderate);
  let arrival: number | null = null;
  let clears: number | null = null;
  if (above.some(Boolean)) {
    // longest run of hours at or above "moderate"
    let bestLen = 0, bestStart = 0, runStart: number | null = null;
    [...above, false].forEach((a, k) => {
      if (a && runStart === null) runStart = k;
      else if (!a && runStart !== null) {
        if (k - runStart > bestLen) { bestLen = k - runStart; bestStart = runStart; }
        runStart = null;
      }
    });
    arrival = times[above.indexOf(true)];
    const end = bestStart + bestLen;
    clears = end < times.length ? times[end] : null;
  }
  let kPeak = 0;
  s.forEach((v, k) => { if (v > s[kPeak]) kPeak = k; });
  const horizon = Math.min(s.length, 25);
  const max24 = Math.max(...s.slice(0, horizon));
  const lightK = s.findIndex((v) => v >= lv.light);
  return {
    series: s,
    level_24h: levelOf(max24, lv),
    light_from: lightK === -1 ? null : times[lightK],
    arrival,
    clears,
    peak: { t: times[kPeak], index: s[kPeak], level: levelOf(s[kPeak], lv) },
  };
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}
