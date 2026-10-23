import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// `vite build` -> dist/forecast-card.html (embedded by the server)
// `vite build --mode preview` -> dist/preview.html (host-less harness for screenshots)
export default defineConfig(({ mode }) => ({
  plugins: [viteSingleFile()],
  build: {
    outDir: "dist",
    emptyOutDir: mode !== "preview",
    assetsInlineLimit: 100_000_000,
    rollupOptions: { input: mode === "preview" ? "preview.html" : "forecast-card.html" },
  },
}));
