// MCP server definition: 3 read-only tools with output schemas + the MCP Apps Echo Show card.
import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { NoReplayError } from "./data.js";
import { CARD_HTML } from "./generated/assets.js";
import { ResultSchema } from "./schema.js";
import { findCleanAirWindow, getFarmFireActivity, getSmokeForecast, type ToolOutput } from "./tools.js";

export const VERSION = "1.0.0";
export const REPO = "https://github.com/VividhDesign/dhuaan-alexa";
const ASSETS = "https://raw.githubusercontent.com/VividhDesign/dhuaan-alexa/main/addon/assets";
export const CARD_URI = "ui://dhuaan/forecast-card.html";
const ICONS = [
  { src: `${ASSETS}/icon-241.png`, mimeType: "image/png", sizes: ["241x241"] },
  { src: `${ASSETS}/icon-64.png`, mimeType: "image/png", sizes: ["64x64"] },
];

export const INSTRUCTIONS =
  "Dhuaan forecasts farm-fire smoke for north India (Punjab, Haryana, Delhi NCR, Chandigarh and western Uttar Pradesh) for the next 36 hours, updated every 3 hours from NASA VIIRS fire detections and GFS winds. All times are India Standard Time. Always use these tools to answer questions about smoke, air quality, farm fires or the best time to be outdoors; never answer them from memory or guess times, counts or levels. If the user names any place, call the tool even if it may be outside north India; the tool decides coverage. The Smoke Index (0–100) is relative; it is not AQI or PM2.5, so describe smoke as none, light, moderate or heavy and never quote it as AQI. Reply in the user's language (Hindi or English). If the user has not named a place, ask which area or city they mean before calling a tool. Lead with the answer (will smoke come, and when), then where it comes from, then one protective step only if smoke is expected; if no smoke is expected, say so plainly. This is not medical advice.";

const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const language = z.enum(["en", "hi"]).optional().describe("Reply language; use 'hi' if the user spoke Hindi or Hinglish");
const place = z.string().min(2).max(80)
  .describe("Area, locality or city in English or Hindi, e.g. 'Rohini', 'Sector 62 Noida', 'Gurugram', 'पटियाला'.");
const ui = { ui: { resourceUri: CARD_URI } };
const replay_date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  .describe("Only to replay a past day, e.g. '2025-10-31'. Omit for the live forecast.");

export type ToolLogger = (line: Record<string, unknown>) => void;
const defaultLogger: ToolLogger = (line) => console.log(JSON.stringify(line));

function wrap<A>(tool: string, fn: (a: A) => Promise<ToolOutput>, log: ToolLogger) {
  return async (args: A) => {
    const t0 = performance.now();
    try {
      const out = await fn(args);
      log({ tool, place_in: (args as any).place ?? null, ...out.log, ms: Math.round(performance.now() - t0) });
      return { content: [{ type: "text" as const, text: out.text }], structuredContent: out.structured };
    } catch (e) {
      if (e instanceof NoReplayError) {
        log({ tool, error: "no_replay", ms: Math.round(performance.now() - t0) });
        return { isError: true, content: [{ type: "text" as const, text: e.message }] };
      }
      throw e;
    }
  };
}

export function createServer(log: ToolLogger = defaultLogger): McpServer {
  const server = new McpServer(
    { name: "dhuaan", title: "Dhuaan Smoke Forecast", version: VERSION, websiteUrl: REPO, icons: ICONS },
    { instructions: INSTRUCTIONS },
  );

  registerAppTool(server, "get_smoke_forecast", {
    title: "Smoke forecast for a place",
    description:
      "Forecast of farm-fire smoke for a place in north India (Delhi NCR, Punjab, Haryana, Chandigarh, western Uttar Pradesh) over the next 36 hours: whether smoke will arrive, when it arrives, peaks and clears, how heavy it will be (none, light, moderate, heavy), and which districts' fires it comes from. Use for questions like \"will smoke come tonight\", \"how bad will the air be tomorrow morning\", \"where is the smoke coming from\", \"धुआँ कब आएगा\". Times are IST.",
    inputSchema: z.object({
      place,
      language,
      replay_date,
    }),
    outputSchema: ResultSchema,
    annotations,
    icons: ICONS,
    _meta: ui,
  } as any, wrap("get_smoke_forecast", getSmokeForecast, log) as any);

  registerAppTool(server, "find_clean_air_window", {
    title: "Best time to be outdoors",
    description:
      "Find the cleanest time in the next 36 hours for an outdoor activity at a place in north India, avoiding farm-fire smoke: a walk, a run, children playing outside, an outdoor event, a school's morning assembly and PE, or airing out the house (when to open and when to close the windows). Returns the best window, alternatives and times to avoid. Times are IST.",
    inputSchema: z.object({
      place,
      activity: z.enum(["walk", "run", "kids_play", "outdoor_event", "school_morning", "ventilate"]).default("walk")
        .describe("walk, run, kids_play (children playing outside), outdoor_event, school_morning (assembly and PE), ventilate (open the windows / air out the house)"),
      duration_hours: z.number().int().min(1).max(6).optional().describe("How long, in hours (default depends on the activity)"),
      day: z.enum(["today", "tomorrow", "next_36h"]).default("next_36h"),
      language,
      replay_date,
    }),
    outputSchema: ResultSchema,
    annotations,
    icons: ICONS,
    _meta: ui,
  } as any, wrap("find_clean_air_window", findCleanAirWindow, log) as any);

  registerAppTool(server, "get_farm_fire_activity", {
    title: "Today's farm fires",
    description:
      "Today's satellite-detected farm fires in north India (Punjab, Haryana and neighbours): how many fires in the last 24 hours, by state, when satellites last passed, and which fire clusters will put smoke over the most people in the next 24 hours (ranked by people-hours under smoke). Use for \"how many stubble fires today\", \"which fires are affecting Delhi\", \"आज कितनी पराली जली\".",
    inputSchema: z.object({
      state: z.enum(["all", "Punjab", "Haryana", "Uttar Pradesh", "Rajasthan"]).default("all"),
      top: z.number().int().min(1).max(10).default(5),
      language,
      replay_date,
    }),
    outputSchema: ResultSchema,
    annotations,
    icons: ICONS,
    _meta: ui,
  } as any, wrap("get_farm_fire_activity", getFarmFireActivity, log) as any);

  registerAppResource(server, "Dhuaan forecast card", CARD_URI,
    { description: "Echo Show card: 36-hour smoke timeline, clean-air window, or today's fires", mimeType: RESOURCE_MIME_TYPE },
    async () => ({ contents: [{ uri: CARD_URI, mimeType: RESOURCE_MIME_TYPE, text: CARD_HTML }] }));

  return server;
}
