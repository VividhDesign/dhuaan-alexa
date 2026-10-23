// Dhuaan forecast data: read from S3 (public/latest/ or public/replay/<date>/), cached in memory.
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { gunzipSync } from "node:zlib";
import { decodeFrames, DEFAULT_LEVELS, type Grid, type Levels } from "./forecast.js";
import type { DhuaanPlace } from "./places.js";

export interface Meta {
  run_id: string; generated_at: number; last_pass_utc: number; wind_source: string;
  fires_24h: number; clusters: number; levels: Levels;
}
export interface PlaceRow extends DhuaanPlace {
  delhi?: boolean; series: number[]; level_24h: string; arrival: number | null; clears: number | null;
  peak: { t: number; index: number }; sources: { label: string; state: string; pct: number }[];
}
export interface Cluster {
  id: string; rank: number; lat: number; lon: number; label: string; district: string; state: string;
  n_fires: number; frp_mw: number; impact_people_hours: number;
}
export interface Hotspots {
  generated_at: number; totals: { fires_24h: number; by_state: Record<string, number> };
  top25_share_delhi_pct: number | null; clusters: Cluster[];
}
export type Advice = Record<string, Record<string, { en: string[]; hi: string[] }>>;

export interface Dataset {
  meta: Meta; places: PlaceRow[]; grid: Grid; times: number[]; frames: Uint8Array[];
  hotspots: Hotspots; advice: Advice; loadedAt: number; stale: boolean; replay_date: string | null;
}

const TTL_MS = 10 * 60 * 1000;
const BUCKET = process.env.DATA_BUCKET ?? "";
const PREFIX = process.env.DATA_PREFIX ?? "public/";
const DATA_URL = process.env.DATA_URL ?? "https://a77m7kh9l5.execute-api.ap-south-1.amazonaws.com/data";
let s3: S3Client | null = null;

async function getJson(path: string): Promise<any> {
  if (BUCKET) {
    s3 ??= new S3Client({});
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: PREFIX + path }));
    let body = Buffer.from(await r.Body!.transformToByteArray());
    if (r.ContentEncoding === "gzip") body = gunzipSync(body);
    return JSON.parse(body.toString("utf-8"));
  }
  // local dev: Dhuaan's public read-only data API
  const r = await fetch(`${DATA_URL}/${path}`);
  if (!r.ok) throw Object.assign(new Error(`GET ${path}: ${r.status}`), { status: r.status });
  return r.json();
}

async function load(base: string, replay_date: string | null): Promise<Dataset> {
  const [meta, places, smoke, hotspots, advice] = await Promise.all(
    ["meta", "places", "smoke", "hotspots", "advice"].map((n) => getJson(`${base}/${n}.json`)),
  );
  return {
    meta: { ...meta, levels: meta.levels ?? DEFAULT_LEVELS },
    places, grid: smoke.grid, times: smoke.times, frames: decodeFrames(smoke.frames),
    hotspots, advice, loadedAt: Date.now(), stale: false, replay_date,
  };
}

let latest: Dataset | null = null;
let inflight: Promise<Dataset> | null = null;

export async function getLatest(): Promise<Dataset> {
  if (latest && Date.now() - latest.loadedAt < TTL_MS) return latest;
  inflight ??= load("latest", null)
    .then((d) => (latest = d))
    .catch((e) => {
      if (latest) { latest = { ...latest, stale: true, loadedAt: Date.now() - TTL_MS + 60_000 }; return latest; }
      throw e;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

const replays = new Map<string, Dataset>(); // LRU of 3

export class NoReplayError extends Error {}

export async function getReplay(date: string): Promise<Dataset> {
  const hit = replays.get(date);
  if (hit) { replays.delete(date); replays.set(date, hit); return hit; }
  let d: Dataset;
  try {
    d = await load(`replay/${date}`, date);
  } catch (e: any) {
    if (e?.name === "NoSuchKey" || e?.status === 404 || e?.$metadata?.httpStatusCode === 404 || e?.name === "AccessDenied")
      throw new NoReplayError(`No replay is available for ${date}.`);
    throw e;
  }
  replays.set(date, d);
  while (replays.size > 3) replays.delete(replays.keys().next().value!);
  return d;
}

/** Seed the cache directly (tests). */
export function setLatestForTest(d: Dataset) { latest = d; }

/** "Now" for a dataset: the wall clock for live data, the run time for a replay. */
export function nowFor(d: Dataset, wall = Math.floor(Date.now() / 1000)): number {
  return d.replay_date ? d.meta.generated_at : wall;
}

/** Data older than 6 h is flagged stale in answers. */
export function isStale(d: Dataset, wall = Math.floor(Date.now() / 1000)): boolean {
  return d.stale || (!d.replay_date && wall - d.meta.generated_at > 6 * 3600);
}
