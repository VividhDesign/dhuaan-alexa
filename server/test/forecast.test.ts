import { describe, expect, it } from "vitest";
import { levelOf, sampleSeries, startIndex, summarize } from "../src/forecast.js";
import { replayDataset } from "./helpers.js";

const H = 3600;
const times = Array.from({ length: 37 }, (_, k) => 1_800_000_000 + k * H);

describe("summarize", () => {
  it("all zero: no arrival, level none", () => {
    const s = summarize(new Array(37).fill(0), times);
    expect(s).toMatchObject({ level_24h: "none", arrival: null, clears: null, light_from: null });
  });
  it("single spike: arrival = clears - 1 h, peak at spike", () => {
    const v = new Array(37).fill(5); v[10] = 70;
    const s = summarize(v, times);
    expect(s.arrival).toBe(times[10]); expect(s.clears).toBe(times[11]);
    expect(s.peak).toMatchObject({ t: times[10], index: 70, level: "heavy" }); expect(s.level_24h).toBe("heavy");
  });
  it("clears is the end of the longest run; arrival the first hour >= 35", () => {
    const v = new Array(37).fill(0); v[2] = 40; for (let k = 8; k < 14; k++) v[k] = 50;
    const s = summarize(v, times);
    expect(s.arrival).toBe(times[2]); expect(s.clears).toBe(times[14]); expect(s.light_from).toBe(times[2]);
  });
  it("level_24h only looks 24 h ahead", () => {
    const v = new Array(37).fill(0); v[30] = 80;
    expect(summarize(v, times).level_24h).toBe("none");
  });
  it("levels bands", () => {
    expect([0, 14, 15, 34, 35, 59, 60].map((x) => levelOf(x))).toEqual(["none", "none", "light", "light", "moderate", "moderate", "heavy"]);
  });
});

describe("parity with Dhuaan's precomputed places (replay 2025-10-31)", () => {
  const d = replayDataset();
  for (const id of ["rohini", "central_delhi", "noida"]) {
    it(id, () => {
      const p = d.places.find((x) => x.id === id)!;
      const s = summarize(p.series, d.times);
      expect(s.arrival).toBe(p.arrival); expect(s.clears).toBe(p.clears); expect(s.peak!.index).toBe(p.peak.index);
      // resampling the grid at the place's coordinates gives the same arrival within 1 h
      const g = summarize(sampleSeries(d.grid, d.frames, p.lat, p.lon)!, d.times);
      expect(Math.abs((g.arrival ?? 0) - p.arrival!)).toBeLessThanOrEqual(3600);
    });
  }
  it("outside the grid -> null", () => { expect(sampleSeries(d.grid, d.frames, 19.07, 72.88)).toBeNull(); });
  it("startIndex picks the current hour", () => { expect(startIndex(d.times, d.times[3] + 600)).toBe(3); });
});
