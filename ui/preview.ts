// Host-less harness: renders a fixture chosen with ?fixture=forecast|window|fires|forecast-hi|clarify
import "./card";
import forecast from "./fixtures/forecast.json";
import win from "./fixtures/window.json";
import fires from "./fixtures/fires.json";
import forecastHi from "./fixtures/forecast-hi.json";

const fixtures: Record<string, unknown> = {
  forecast, window: win, fires, "forecast-hi": forecastHi,
  clarify: { kind: "clarify", language: "en", message: { en: "Which Rohini did you mean — Rohini, Delhi or Rohini in Haryana?", hi: "कौन सा रोहिणी?" }, disclaimer: (forecast as any).disclaimer },
};
const q = new URLSearchParams(location.search);
const name = q.get("fixture") ?? "forecast";
if (q.get("theme") === "light") document.documentElement.dataset.theme = "light";
(window as any).__render(fixtures[name] ?? forecast);
