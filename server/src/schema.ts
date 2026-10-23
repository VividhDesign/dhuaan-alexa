// The structuredContent contract shared by every tool and the Echo Show card (plan §7.6).
import * as z from "zod/v4";

const level = z.enum(["none", "light", "moderate", "heavy"]);
const bi = z.object({ en: z.string(), hi: z.string() });
const biList = z.object({ en: z.array(z.string()), hi: z.array(z.string()) });
const epoch = z.number().int().nullable();
const slot = z.object({ start: z.number().int(), end: z.number().int(), max_index: z.number(), level });

export const ResultSchema = z.object({
  kind: z.enum(["forecast", "window", "fires", "compare", "clarify", "out_of_area"]),
  language: z.enum(["en", "hi"]),
  place: z.object({
    id: z.string(), name: bi, lat: z.number(), lon: z.number(),
    match: z.enum(["exact", "alias", "fuzzy", "geocoded"]),
    forecast_point: z.enum(["dhuaan_place", "grid_sample"]),
  }).nullable().optional(),
  now: z.number().int().optional(),
  run: z.object({
    generated_at: z.number().int(), last_pass_utc: z.number().int(), fires_24h: z.number().int(),
    clusters: z.number().int(), wind_source: z.string(), stale: z.boolean(), replay_date: z.string().nullable(),
  }).optional(),
  level_24h: level.optional(),
  light_from: epoch.optional(),
  arrival: epoch.optional(),
  clears: epoch.optional(),
  peak: z.object({ t: z.number().int(), index: z.number(), level }).nullable().optional(),
  series: z.array(z.object({ t: z.number().int(), index: z.number(), level })).optional(),
  sources: z.array(z.object({ label: z.string(), state: z.string(), pct: z.number() })).optional(),
  sources_scope: z.enum(["place", "region"]).optional(),
  window: z.object({
    activity: z.string(), duration_h: z.number(), day: z.string().optional(), best: slot.nullable(),
    alternatives: z.array(slot), avoid: z.array(z.object({ start: z.number().int(), end: z.number().int(), peak_index: z.number() })),
    verdict: z.enum(["good", "caution", "indoors"]), close_by: epoch, widened: z.boolean().optional(),
  }).optional(),
  fires: z.object({
    fires_24h: z.number().int(), by_state: z.record(z.string(), z.number()), clusters: z.number().int(),
    last_pass_utc: z.number().int(), top25_share_delhi_pct: z.number().nullable(), state: z.string().optional(),
    top: z.array(z.object({
      label: z.string(), district: z.string(), state: z.string(), n_fires: z.number(), frp_mw: z.number(),
      impact_people_hours: z.number(),
    })),
  }).optional(),
  compare: z.array(z.object({
    place: z.object({ id: z.string(), name: bi }), level_24h: level, arrival: epoch,
    peak: z.object({ t: z.number().int(), index: z.number(), level }).nullable(),
  })).optional(),
  advice: biList.optional(),
  summary: bi.optional(),
  message: bi.optional(),
  levels: z.object({ light: z.number(), moderate: z.number(), heavy: z.number() }).optional(),
  disclaimer: bi,
});

export type Result = z.infer<typeof ResultSchema>;
