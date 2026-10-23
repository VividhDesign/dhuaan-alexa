import { describe, expect, it } from "vitest";
import { findWindow, istHour } from "../src/window.js";

// times on the hour UTC = :30 IST; start at 18:30 IST on some day
const t0 = Date.UTC(2026, 9, 23, 13, 0) / 1000; // 13:00 UTC = 18:30 IST
const times = Array.from({ length: 37 }, (_, k) => t0 + k * 3600);
const ist = (k: number) => istHour(times[k]);

describe("findWindow", () => {
  it("clean air: good verdict, daylight start", () => {
    const w = findWindow({ series: new Array(37).fill(3), times, now: t0, activity: "walk" });
    expect(w.verdict).toBe("good");
    const h = istHour(w.best!.start); expect(h).toBeGreaterThanOrEqual(6); expect(h + 1).toBeLessThanOrEqual(20);
  });
  it("overnight plume: avoid block, best window outside it", () => {
    const v = times.map((_, k) => (ist(k) >= 2 && ist(k) < 11 && k < 24 ? 55 : 5));
    const w = findWindow({ series: v, times, now: t0, activity: "kids_play", day: "tomorrow" });
    expect(w.avoid.length).toBeGreaterThan(0);
    expect(w.best!.max_index).toBeLessThan(15); expect(w.verdict).toBe("good"); expect(w.duration_h).toBe(2);
  });
  it("all-day heavy: indoors", () => {
    const w = findWindow({ series: new Array(37).fill(70), times, now: t0, activity: "walk", day: "tomorrow" });
    expect(w.verdict).toBe("indoors"); expect(w.best!.level).toBe("heavy");
  });
  it("run is stricter than walk", () => {
    const v = new Array(37).fill(20);
    expect(findWindow({ series: v, times, now: t0, activity: "walk" }).verdict).toBe("caution");
    expect(findWindow({ series: v, times, now: t0, activity: "run" }).verdict).toBe("indoors");
  });
  it("school_morning is 07:30–13:30 IST next morning", () => {
    const w = findWindow({ series: new Array(37).fill(20), times, now: t0, activity: "school_morning" });
    expect(istHour(w.best!.start)).toBeCloseTo(7.5); expect(w.best!.end - w.best!.start).toBe(6 * 3600); expect(w.verdict).toBe("caution");
  });
  it("ventilate returns close_by at the next light hour", () => {
    const v = new Array(37).fill(3); v[30] = 20;
    const w = findWindow({ series: v, times, now: t0, activity: "ventilate" });
    expect(w.close_by).toBe(times[30]);
  });
  it("today with no daylight left widens to next 36 h", () => {
    const late = Date.UTC(2026, 9, 23, 16, 0) / 1000; // 21:30 IST
    const tt = times.map((t) => t + (late - t0));
    const w = findWindow({ series: new Array(37).fill(3), times: tt, now: late, activity: "walk", day: "today" });
    expect(w.widened).toBe(true); expect(w.best).not.toBeNull();
  });
});
