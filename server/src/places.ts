// Place resolution: exact/alias -> fuzzy (Jaro-Winkler) -> Amazon Location geocode.
import { GeoPlacesClient, GeocodeCommand } from "@aws-sdk/client-geo-places";
import gazetteer from "./gazetteer.json" with { type: "json" };

export type Match = "exact" | "alias" | "fuzzy" | "geocoded";
export interface Place {
  id: string;
  name: { en: string; hi: string };
  lat: number;
  lon: number;
  match: Match;
  dhuaan: boolean; // one of Dhuaan's precomputed forecast places
}
export interface DhuaanPlace { id: string; name: { en: string; hi: string }; lat: number; lon: number }

// Common spellings and names that point at one of Dhuaan's 29 places.
const DHUAAN_ALIASES: Record<string, string> = {
  gurgaon: "gurugram", gurgoan: "gurugram", "गुड़गांव": "gurugram", "गुड़गाँव": "gurugram",
  delhi: "central_delhi", "new delhi": "central_delhi", dilli: "central_delhi", "दिल्ली": "central_delhi",
  "नई दिल्ली": "central_delhi", ito: "central_delhi", "central delhi": "central_delhi",
  "south delhi": "south_delhi", "east delhi": "east_delhi", "north east delhi": "ne_delhi",
  "northeast delhi": "ne_delhi", "west delhi": "west_delhi", "north west delhi": "rohini", "northwest delhi": "rohini",
  "noida city": "noida", ghaziabad: "ghaziabad", bawana: "narela", "narela bawana": "narela",
  "पंजाबी बाग": "west_delhi", "punjabi bagh": "west_delhi", "anand vihar": "east_delhi",
  "chandigarh tricity": "chandigarh", "tricity": "chandigarh", ncr: "central_delhi", "delhi ncr": "central_delhi",
};

const STRIP = /\b(in|near|at|my|area|city|me|the|ka|ki|ke|mein|main|around|district|sector of)\b/g;
const HI_STRIP = /(में|के पास|का|की|के|इलाक़ा|इलाका|शहर)/g;

export function normalize(s: string): string {
  return s
    .normalize("NFC")
    .toLowerCase()
    .replace(/[.,!?'"()]/g, " ")
    .replace(HI_STRIP, " ")
    .replace(STRIP, " ")
    .replace(/[–—-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length, lb = b.length;
  if (!la || !lb) return 0;
  const range = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const ma = new Array(la).fill(false), mb = new Array(lb).fill(false);
  let m = 0;
  for (let i = 0; i < la; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(lb, i + range + 1); j++) {
      if (!mb[j] && a[i] === b[j]) { ma[i] = mb[j] = true; m++; break; }
    }
  }
  if (!m) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < la; i++) if (ma[i]) { while (!mb[k]) k++; if (a[i] !== b[k]) t++; k++; }
  const jaro = (m / la + m / lb + (m - t / 2) / m) / 3;
  let p = 0;
  while (p < Math.min(4, la, lb) && a[p] === b[p]) p++;
  return jaro + p * 0.1 * (1 - jaro);
}

interface Entry { key: string; id: string; kind: "exact" | "alias" }
interface Record_ { id: string; name: { en: string; hi: string }; lat: number; lon: number; dhuaan: boolean }

let index: { entries: Entry[]; byId: Map<string, Record_> } | null = null;
let indexFor: DhuaanPlace[] | null = null;

function buildIndex(dhuaan: DhuaanPlace[]) {
  const byId = new Map<string, Record_>();
  const entries: Entry[] = [];
  const add = (key: string, id: string, kind: Entry["kind"]) => {
    const k = normalize(key);
    if (k && !entries.some((e) => e.key === k)) entries.push({ key: k, id, kind });
  };
  for (const p of dhuaan) {
    byId.set(p.id, { ...p, dhuaan: true });
    add(p.name.en, p.id, "exact");
    add(p.name.hi, p.id, "exact");
    // "Rohini, Delhi" -> "rohini"; "Narela–Bawana, Delhi" -> "narela", "bawana"
    for (const part of p.name.en.split(/[,/–]/)) add(part, p.id, "alias");
    for (const part of p.name.hi.split(/[,/–]/)) add(part, p.id, "alias");
    add(p.id.replace(/_/g, " "), p.id, "alias");
  }
  for (const g of gazetteer as any[]) {
    if (byId.has(g.id)) continue;
    byId.set(g.id, { id: g.id, name: g.name, lat: g.lat, lon: g.lon, dhuaan: false });
    add(g.name.en, g.id, "exact");
    add(g.name.hi, g.id, "exact");
    for (const a of g.aliases ?? []) add(a, g.id, "alias");
    add(g.id.replace(/_/g, " "), g.id, "alias");
  }
  for (const [k, id] of Object.entries(DHUAAN_ALIASES)) if (byId.has(id)) add(k, id, "alias");
  return { entries, byId };
}

let geoClient: GeoPlacesClient | null = null;
const geoCache = new Map<string, { label: string; lat: number; lon: number } | null>();

export type Geocoder = (q: string) => Promise<{ label: string; lat: number; lon: number } | null>;

export const amazonLocationGeocode: Geocoder = async (q) => {
  if (geoCache.has(q)) return geoCache.get(q)!;
  geoClient ??= new GeoPlacesClient({ region: process.env.GEO_REGION ?? process.env.AWS_REGION ?? "ap-south-1" });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 350);
  try {
    const r = await geoClient.send(
      new GeocodeCommand({ QueryText: q.slice(0, 200), MaxResults: 1, Filter: { IncludeCountries: ["IND"] }, BiasPosition: [77.1, 28.7] }),
      { abortSignal: ctl.signal },
    );
    const it = r.ResultItems?.[0];
    const out = it?.Position ? { label: it.Title ?? q, lat: it.Position[1], lon: it.Position[0] } : null;
    geoCache.set(q, out);
    return out;
  } catch {
    return null; // timeouts are not cached
  } finally {
    clearTimeout(timer);
  }
};

export async function resolvePlace(input: string, dhuaan: DhuaanPlace[], geocode: Geocoder = amazonLocationGeocode): Promise<Place | null> {
  if (!index || indexFor !== dhuaan) { index = buildIndex(dhuaan); indexFor = dhuaan; }
  const q = normalize(input);
  if (q.length < 2) return null;
  const hit = (id: string, match: Match): Place => { const r = index!.byId.get(id)!; return { ...r, match }; };

  const exact = index.entries.find((e) => e.key === q);
  if (exact) return hit(exact.id, exact.kind);

  // "sector 62 noida" style: try dropping trailing words ("rohini delhi" -> "rohini")
  const words = q.split(" ");
  for (let n = words.length - 1; n >= 1; n--) {
    const head = words.slice(0, n).join(" ");
    const e = index.entries.find((x) => x.key === head);
    if (e) return hit(e.id, "alias");
  }

  let best: Entry | null = null, score = 0;
  for (const e of index.entries) {
    const s = jaroWinkler(q, e.key);
    if (s > score) { score = s; best = e; }
  }
  if (best && score >= 0.9) return hit(best.id, "fuzzy");

  const g = await geocode(input.trim());
  if (!g) return null;
  return { id: `geo:${g.lat.toFixed(3)},${g.lon.toFixed(3)}`, name: { en: g.label, hi: g.label }, lat: g.lat, lon: g.lon, match: "geocoded", dhuaan: false };
}
