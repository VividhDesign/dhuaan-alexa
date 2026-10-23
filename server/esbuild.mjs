import { build } from "esbuild";
const common = { bundle: true, platform: "node", target: "node22", format: "cjs", sourcemap: false, minify: false, logLevel: "info" };
await build({ ...common, entryPoints: ["src/lambda.ts"], outfile: "dist/lambda.js" });
await build({ ...common, entryPoints: ["src/local.ts"], outfile: "dist/local.cjs" });
