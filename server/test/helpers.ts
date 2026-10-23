import { readFileSync } from "node:fs";
import { decodeFrames } from "../src/forecast.js";
import { setLatestForTest, type Dataset } from "../src/data.js";

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), "utf-8"));

/** The 31 Oct 2025 replay (run 20:30 IST), loaded as if it were the live forecast. */
export function replayDataset(): Dataset {
  const smoke = fx("smoke");
  const meta = fx("meta");
  return { meta, places: fx("places"), grid: smoke.grid, times: smoke.times, frames: decodeFrames(smoke.frames),
    hotspots: fx("hotspots"), advice: fx("advice"), loadedAt: Date.now() + 1e12, stale: false, replay_date: null };
}
export function seed() { const d = replayDataset(); setLatestForTest(d); return d; }
