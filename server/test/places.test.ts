import { describe, expect, it } from "vitest";
import { jaroWinkler, normalize, resolvePlace } from "../src/places.js";
import { replayDataset } from "./helpers.js";

const d = replayDataset();
const noGeo = async () => null;
const r = (q: string) => resolvePlace(q, d.places, noGeo);

describe("resolvePlace", () => {
  it.each([
    ["Rohini", "rohini"], ["rohini delhi", "rohini"], ["रोहिणी", "rohini"], ["Gurgaon", "gurugram"], ["Gurgoan", "gurugram"],
    ["Rohni", "rohini"], ["Delhi", "central_delhi"], ["दिल्ली", "central_delhi"], ["new delhi", "central_delhi"],
    ["Sector 62 Noida", "noida_sector_62"], ["पटियाला", "patiala"], ["in my area Pitampura", "pitampura"], ["CP", "connaught_place"],
    ["नोएडा में", "noida"], ["Mohali", "mohali"],
  ])("%s -> %s", async (q, id) => { expect((await r(q))?.id).toBe(id); });
  it("unknown without geocoder -> null (clarify)", async () => { expect(await r("xx")).toBeNull(); expect(await r("Qwertyville")).toBeNull(); });
  it("geocoder fallback", async () => {
    const p = await resolvePlace("Mumbai", d.places, async () => ({ label: "Mumbai, Maharashtra, India", lat: 19.07, lon: 72.88 }));
    expect(p?.match).toBe("geocoded");
  });
  it("normalize + jaro-winkler", () => {
    expect(normalize("  Near ROHINI, Delhi! ")).toBe("rohini delhi");
    expect(jaroWinkler("gurugram", "gurgoan")).toBeLessThan(1);
  });
});
