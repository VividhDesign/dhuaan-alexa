import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// `vite build`                -> dist/forecast-card.html (the MCP App card the server embeds)
// `vite build --mode preview` -> dist/preview.html       (host-less card harness for screenshots)
// `vite build --mode sim`     -> dist/sim.html           (Alexa+ experience simulator web app)
const inputs: Record<string, string> = { preview: "preview.html", sim: "sim.html" };

export default defineConfig(({ mode }) => ({
  plugins: [viteSingleFile()],
  build: {
    outDir: "dist",
    emptyOutDir: !(mode in inputs),
    assetsInlineLimit: 100_000_000,
    rollupOptions: { input: inputs[mode] ?? "forecast-card.html" },
  },
}));
